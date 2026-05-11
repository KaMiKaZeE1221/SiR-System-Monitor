const { app, BrowserWindow, Menu, Tray, ipcMain, shell, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { autoUpdater } = require('electron-updater');
// Discord Rich Presence (in-repo IPC helper)
const DISCORD_CLIENT_ID = '1479994487215227094';
let discordIpc = null;
try {
  discordIpc = require('./lib/discord-ipc');
  if (discordIpc) {
    discordIpc.onClose = () => {
      sendDiscordPresenceStatus({ enabled: appBehaviorSettings.enableDiscordRichPresence, connected: false });
    };
  }
} catch (err) {
  console.warn('discord-ipc helper not available — Discord Rich Presence disabled.');
}

const enableGpuAcceleration = process.env.SIR_ENABLE_GPU_ACCELERATION === '1';
if (!enableGpuAcceleration) {
  app.disableHardwareAcceleration();
}

const APP_BEHAVIOR_SETTINGS_FILE = 'appBehaviorSettings.json';
const DEFAULT_APP_BEHAVIOR_SETTINGS = {
  launchAtStartup: false,
  startMinimized: false,
  minimizeToTray: false,
  closeToTray: false,
  enableDiscordRichPresence: true
};

let mainWindow = null;
let tray = null;
let isQuitting = false;
let appBehaviorSettings = { ...DEFAULT_APP_BEHAVIOR_SETTINGS };
let autoUpdaterInitialized = false;
let updateDownloadedInfo = null;
let discordActivityInterval = null;
let discordReconnectInterval = null;
const DISCORD_ACTIVITY_INTERVAL_MS = 5_000;
const DISCORD_RECONNECT_INTERVAL_MS = 5_000;
let currentOverlayHotkey = null;

function isMissingLatestYmlError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('cannot find latest.yml') || message.includes('latest.yml') && message.includes('404');
}

function isAutoUpdaterSupported() {
  return !!autoUpdater && app.isPackaged;
}

function sendUpdateStatus(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send('app-update:status', payload);
  } catch (error) {
    console.error('Failed to send update status to renderer:', error);
  }
}

function sendDiscordPresenceStatus(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send('discord-presence:status', payload);
  } catch (error) {
    console.error('Failed to send Discord status to renderer:', error);
  }
}

function setupAutoUpdater() {
  if (autoUpdaterInitialized || !isAutoUpdaterSupported()) {
    return;
  }

  autoUpdaterInitialized = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus({ state: 'checking', currentVersion: app.getVersion() });
  });

  autoUpdater.on('update-available', (info) => {
    const latestVersion = String(info?.version || info?.tag || '').trim();
    const releaseUrl = typeof info?.releaseNotes === 'string' && /^https?:\/\//i.test(info.releaseNotes)
      ? info.releaseNotes
      : '';
    const releaseNotes = typeof info?.releaseNotes === 'string' && !/^https?:\/\//i.test(info.releaseNotes)
      ? info.releaseNotes
      : '';
    const releaseTitle = String(info?.releaseName || info?.releaseTitle || info?.name || info?.tag || '').trim();

    sendUpdateStatus({
      state: 'available',
      currentVersion: app.getVersion(),
      latestVersion,
      releaseTitle,
      releaseNotes,
      releaseUrl,
      message: latestVersion
        ? `Update ${latestVersion} found. Choose Download to continue.`
        : 'Update found. Choose Download to continue.'
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus({
      state: 'downloading',
      percent: Number(progress?.percent || 0),
      bytesPerSecond: Number(progress?.bytesPerSecond || 0),
      transferred: Number(progress?.transferred || 0),
      total: Number(progress?.total || 0)
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    sendUpdateStatus({
      state: 'not-available',
      currentVersion: app.getVersion(),
      latestVersion: String(info?.version || app.getVersion())
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    updateDownloadedInfo = info || {};
    sendUpdateStatus({
      state: 'downloaded',
      currentVersion: app.getVersion(),
      latestVersion: String(info?.version || '').trim(),
      message: 'Update downloaded. Click Restart to install now.'
    });
  });

  autoUpdater.on('error', (error) => {
    const isMissingMetadata = isMissingLatestYmlError(error);
    sendUpdateStatus({
      state: 'error',
      currentVersion: app.getVersion(),
      code: isMissingMetadata ? 'missing-latest-yml' : 'auto-updater-error',
      error: isMissingMetadata
        ? 'In-app auto update is unavailable because latest.yml is missing from the GitHub release assets.'
        : (error?.message || 'Unknown updater error.')
    });
  });
}

function parseVersionParts(version) {
  const normalized = String(version || '').trim().replace(/^v/i, '');
  if (!/^\d+(\.\d+){0,2}([.-].*)?$/.test(normalized)) {
    return null;
  }
  const core = normalized.split('-')[0].split('+')[0];
  const segments = core.split('.').map((part) => Number(part));
  if (segments.some((segment) => !Number.isFinite(segment))) {
    return null;
  }
  while (segments.length < 3) {
    segments.push(0);
  }
  return segments.slice(0, 3);
}

function compareVersions(a, b) {
  const left = parseVersionParts(a);
  const right = parseVersionParts(b);
  if (!left || !right) {
    return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
  }

  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }

  return 0;
}

function readLocalPackageJson() {
  try {
    const packagePath = path.join(__dirname, 'package.json');
    if (!fs.existsSync(packagePath)) return null;
    const raw = fs.readFileSync(packagePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function parseGithubRepo(repositoryField) {
  const raw = typeof repositoryField === 'string'
    ? repositoryField
    : typeof repositoryField?.url === 'string'
      ? repositoryField.url
      : '';

  const text = raw.trim();
  if (!text) return null;

  const shorthandMatch = text.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (shorthandMatch) {
    return {
      owner: shorthandMatch[1],
      repo: shorthandMatch[2].replace(/\.git$/i, '')
    };
  }

  const normalized = text
    .replace(/^git\+/i, '')
    .replace(/^git@github\.com:/i, 'https://github.com/');

  const urlMatch = normalized.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)(?:[/?#].*)?$/i);
  if (!urlMatch) return null;

  return {
    owner: urlMatch[1],
    repo: urlMatch[2].replace(/\.git$/i, '')
  };
}

function getLatestReleaseUrl(repositoryField) {
  const repo = parseGithubRepo(repositoryField);
  if (!repo) return '';
  return `https://github.com/${repo.owner}/${repo.repo}/releases/latest`;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        'User-Agent': 'SiR-System-Monitor-UpdateChecker',
        Accept: 'application/json'
      }
    }, (response) => {
      const status = Number(response.statusCode || 0);
      const chunks = [];

      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (status < 200 || status >= 300) {
          reject(new Error(`HTTP ${status}`));
          return;
        }

        try {
          resolve(JSON.parse(text));
        } catch (error) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });

    request.on('error', reject);
    request.setTimeout(10000, () => {
      request.destroy(new Error('Request timed out'));
    });
  });
}

async function checkForAppUpdates() {
  const currentVersion = app.getVersion();
  const packageJson = readLocalPackageJson();

  if (!packageJson) {
    return {
      ok: false,
      configured: false,
      currentVersion,
      error: 'Could not read package metadata.'
    };
  }

  const githubRepo = parseGithubRepo(packageJson.repository);
  if (githubRepo) {
    try {
      const release = await fetchJson(`https://api.github.com/repos/${githubRepo.owner}/${githubRepo.repo}/releases/latest`);
      const latestVersion = String(release.tag_name || release.name || '').trim();

      if (!latestVersion) {
        return {
          ok: false,
          configured: true,
          source: 'github',
          currentVersion,
          error: 'Latest release did not include a version tag.'
        };
      }

      return {
        ok: true,
        configured: true,
        source: 'github',
        currentVersion,
        latestVersion,
        updateAvailable: compareVersions(currentVersion, latestVersion) < 0,
        releaseUrl: typeof release.html_url === 'string' ? release.html_url : '',
        publishedAt: release.published_at || release.created_at || '',
        releaseNotes: typeof release.body === 'string' ? release.body : '',
        releaseTitle: typeof release.name === 'string' ? release.name : ''
      };
    } catch (error) {
      return {
        ok: false,
        configured: true,
        source: 'github',
        currentVersion,
        error: `GitHub check failed: ${error.message}`
      };
    }
  }

  try {
    const packageName = String(packageJson.name || '').trim();
    if (!packageName) {
      throw new Error('Package name is missing');
    }

    const npmLatest = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`);
    const latestVersion = String(npmLatest.version || '').trim();
    if (!latestVersion) {
      throw new Error('NPM latest version was empty');
    }

    const homepageUrl = typeof npmLatest.homepage === 'string'
      ? npmLatest.homepage
      : typeof packageJson.homepage === 'string'
        ? packageJson.homepage
        : '';

    return {
      ok: true,
      configured: true,
      source: 'npm',
      currentVersion,
      latestVersion,
      updateAvailable: compareVersions(currentVersion, latestVersion) < 0,
      releaseUrl: homepageUrl
    };
  } catch (error) {
    return {
      ok: false,
      configured: false,
      currentVersion,
      error: 'No update source configured. Add a GitHub repository URL in package.json to enable release checks.'
    };
  }
}

function getBehaviorSettingsPath() {
  return path.join(app.getPath('userData'), APP_BEHAVIOR_SETTINGS_FILE);
}

function normalizeBehaviorSettings(settings) {
  return {
    launchAtStartup: !!settings?.launchAtStartup,
    startMinimized: !!settings?.startMinimized,
    minimizeToTray: !!settings?.minimizeToTray,
    closeToTray: !!settings?.closeToTray,
    enableDiscordRichPresence: typeof settings?.enableDiscordRichPresence === 'boolean'
      ? settings.enableDiscordRichPresence
      : true
  };
}

function loadBehaviorSettings() {
  try {
    const settingsPath = getBehaviorSettingsPath();
    if (!fs.existsSync(settingsPath)) {
      return { ...DEFAULT_APP_BEHAVIOR_SETTINGS };
    }
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeBehaviorSettings(parsed);
  } catch (error) {
    return { ...DEFAULT_APP_BEHAVIOR_SETTINGS };
  }
}

function saveBehaviorSettings(settings) {
  appBehaviorSettings = normalizeBehaviorSettings(settings);
  try {
    fs.writeFileSync(getBehaviorSettingsPath(), JSON.stringify(appBehaviorSettings, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to save app behavior settings:', error);
  }
  return appBehaviorSettings;
}

function applyLoginItemSettings() {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!appBehaviorSettings.launchAtStartup,
      path: process.execPath
    });
  } catch (error) {
    console.error('Failed to apply startup login settings:', error);
  }
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;
  tray = new Tray(path.join(__dirname, 'SiR_SM_Circle.ico'));
  tray.setToolTip('SiR System Monitor');
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Open',
      click: () => showMainWindow()
    },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
  tray.on('double-click', () => {
    showMainWindow();
  });
}

function destroyTrayIfUnused() {
  if (!tray) return;
  if (appBehaviorSettings.minimizeToTray || appBehaviorSettings.closeToTray) return;
  tray.destroy();
  tray = null;
}

// Initialize Discord Rich Presence (called after app is ready)
function clearDiscordIntervals() {
  if (discordActivityInterval) {
    clearInterval(discordActivityInterval);
    discordActivityInterval = null;
  }
  if (discordReconnectInterval) {
    clearInterval(discordReconnectInterval);
    discordReconnectInterval = null;
  }
}

function scheduleDiscordReconnect() {
  if (!appBehaviorSettings.enableDiscordRichPresence) return;
  if (discordReconnectInterval) return;

  discordReconnectInterval = setInterval(() => {
    if (discordIpc?.connected) {
      clearDiscordIntervals();
      return;
    }
    initDiscordRPC();
  }, DISCORD_RECONNECT_INTERVAL_MS);
}

function initDiscordRPC() {
  if (!discordIpc || typeof discordIpc.connect !== 'function') return;
  if (!appBehaviorSettings.enableDiscordRichPresence) return;
  if (discordIpc.connected) {
    setDiscordActivity();
    if (!discordActivityInterval) {
      discordActivityInterval = setInterval(setDiscordActivity, DISCORD_ACTIVITY_INTERVAL_MS);
    }
    return;
  }

  try {
    discordIpc.connect(DISCORD_CLIENT_ID).then(() => {
      if (!appBehaviorSettings.enableDiscordRichPresence) return;
      sendDiscordPresenceStatus({ enabled: true, connected: true });
      setDiscordActivity();
      if (!discordActivityInterval) {
        discordActivityInterval = setInterval(setDiscordActivity, DISCORD_ACTIVITY_INTERVAL_MS);
      }
      if (discordReconnectInterval) {
        clearInterval(discordReconnectInterval);
        discordReconnectInterval = null;
      }
    }).catch(() => {
      sendDiscordPresenceStatus({ enabled: appBehaviorSettings.enableDiscordRichPresence, connected: false });
      scheduleDiscordReconnect();
    });
  } catch (error) {
    scheduleDiscordReconnect();
  }
}

function setDiscordActivity() {
  if (!discordIpc || typeof discordIpc.setActivity !== 'function') return;
  if (!appBehaviorSettings.enableDiscordRichPresence) return;
  if (!discordIpc.connected) {
    initDiscordRPC();
    return;
  }
  try {
    // Updated presence payload per provided example
    discordIpc.setActivity({
      details: 'Monitoring System Stats',
      state: 'Active',
      startTimestamp: Math.floor(Date.now() / 1000),
      largeImageKey: 'sir_sm_circle',
      largeImageText: 'Numbani',
      smallImageKey: 'sir_sm_circle',
      smallImageText: `v${app.getVersion()}`,
      partyMax: 5,
      joinSecret: 'MTI4NzM0OjFpMmhuZToxMjMxMjM=',
      buttons: [
        { label: 'Project', url: 'https://github.com/KaMiKaZeE1221/SiR-System-Monitor' }
      ]
    });
  } catch (error) {
    // ignore
  }
}

function syncTrayState() {
  if (appBehaviorSettings.minimizeToTray || appBehaviorSettings.closeToTray) {
    createTray();
    return;
  }
  destroyTrayIfUnused();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    icon: path.join(__dirname, 'SiR_SM_Circle.ico'),
    autoHideMenuBar: true,
    show: !appBehaviorSettings.startMinimized,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.setMenuBarVisibility(false);

  // Send initial Discord presence status once the window has loaded
  mainWindow.webContents.on('did-finish-load', () => {
    if (appBehaviorSettings.enableDiscordRichPresence && discordIpc?.connected) {
      sendDiscordPresenceStatus({ enabled: true, connected: true });
    } else if (appBehaviorSettings.enableDiscordRichPresence) {
      sendDiscordPresenceStatus({ enabled: true, connected: false });
    } else {
      sendDiscordPresenceStatus({ enabled: false, connected: false });
    }
  });

  mainWindow.on('minimize', (event) => {
    if (!appBehaviorSettings.minimizeToTray) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('close', (event) => {
    if (isQuitting || !appBehaviorSettings.closeToTray) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (appBehaviorSettings.startMinimized) {
    mainWindow.once('ready-to-show', () => {
      if (!mainWindow) return;
      mainWindow.show();
      mainWindow.minimize();
    });
  }
}

let overlayWindow = null;
let overlayHotkeySetting = '';
let overlayDragUnlockEnabled = false;
let overlayDragSession = null;
const OVERLAY_DRAG_SNAP_PX = 8;

function applyOverlayCompatibility() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  if (typeof overlayWindow.setVisibleOnAllWorkspaces === 'function') {
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
}

function applyOverlayInteractionMode() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  try {
    overlayWindow.setIgnoreMouseEvents(!overlayDragUnlockEnabled, { forward: true });
  } catch (_error) {
    try {
      overlayWindow.setIgnoreMouseEvents(!overlayDragUnlockEnabled);
    } catch (_ignored) {}
  }
}

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow;
  }

  overlayWindow = new BrowserWindow({
    width: 360,
    height: 220,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false
    }
  });

  overlayWindow.loadFile('overlay.html');
  overlayWindow.setMenuBarVisibility(false);
  applyOverlayInteractionMode();
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  if (typeof overlayWindow.setVisibleOnAllWorkspaces === 'function') {
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });

  return overlayWindow;
}

function getOverlayDisplay(displayId) {
  if (displayId === null || displayId === undefined || String(displayId).trim() === '') {
    return screen.getPrimaryDisplay();
  }
  const display = screen.getAllDisplays().find((entry) => String(entry.id) === String(displayId));
  return display || screen.getPrimaryDisplay();
}

function destroyOverlayWindow() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayWindow = null;
    return;
  }
  try {
    overlayWindow.close();
  } catch (e) {
    overlayWindow = null;
  }
}

ipcMain.handle('overlay:set-enabled', (_event, enabled) => {
  if (enabled) {
    createOverlayWindow();
    applyOverlayInteractionMode();
  } else {
    destroyOverlayWindow();
  }
  // Keep hotkey registered even when overlay is hidden so it can toggle back on.
  if (overlayHotkeySetting) registerOverlayHotkey(overlayHotkeySetting);
  return !!enabled;
});

ipcMain.handle('overlay:set-drag-enabled', (_event, enabled) => {
  overlayDragUnlockEnabled = !!enabled;
  applyOverlayInteractionMode();
  return true;
});

ipcMain.handle('overlay:update-hotkey', (_event, hotkey) => {
  overlayHotkeySetting = String(hotkey || '').trim();
  if (overlayHotkeySetting) registerOverlayHotkey(overlayHotkeySetting);
  else unregisterOverlayHotkey();
  return true;
});

ipcMain.handle('overlay:get-displays', (_event) => {
  return screen.getAllDisplays().map((display) => ({
    id: display.id,
    name: `${display.label || `Display ${display.id}`}${display.primary ? ' (Primary)' : ''}`
  }));
});

function registerOverlayHotkey(hotkey) {
  if (currentOverlayHotkey) {
    globalShortcut.unregister(currentOverlayHotkey);
    currentOverlayHotkey = null;
  }
  
  if (hotkey && hotkey.trim()) {
    try {
      const rawParts = String(hotkey).split('+').map((part) => part.trim()).filter(Boolean);
      if (rawParts.length < 1) return;

      const key = rawParts[rawParts.length - 1];
      const modifierParts = rawParts.slice(0, -1).map((part) => part.toLowerCase());
      const modifiers = [];

      if (modifierParts.includes('ctrl') || modifierParts.includes('control')) modifiers.push('CommandOrControl');
      if (modifierParts.includes('alt')) modifiers.push('Alt');
      if (modifierParts.includes('shift')) modifiers.push('Shift');
      if (modifierParts.includes('meta') || modifierParts.includes('cmd') || modifierParts.includes('command')) modifiers.push('Super');

      if (!key) return;
      const normalizedKeyMap = {
        escape: 'Esc',
        enter: 'Enter',
        tab: 'Tab',
        backspace: 'Backspace',
        delete: 'Delete',
        insert: 'Insert',
        home: 'Home',
        end: 'End',
        pageup: 'PageUp',
        pagedown: 'PageDown',
        up: 'Up',
        down: 'Down',
        left: 'Left',
        right: 'Right',
        space: 'Space',
        numadd: 'numadd',
        numsub: 'numsub',
        nummult: 'nummult',
        numdiv: 'numdiv',
        numdec: 'numdec'
      };
      const keyLower = String(key).toLowerCase();
      let normalizedKey = normalizedKeyMap[keyLower] || key;
      if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(normalizedKey)) normalizedKey = normalizedKey.toUpperCase();
      if (String(normalizedKey).length === 1) normalizedKey = String(normalizedKey).toUpperCase();

      const keyCandidates = (() => {
        const candidates = [normalizedKey];
        const m = String(normalizedKey).match(/^num([0-9])$/i);
        if (m) {
          candidates.push(`Numpad${m[1]}`);
          candidates.push(m[1]);
          const arrowByNum = {
            8: ['NumpadUp', 'Up'],
            2: ['NumpadDown', 'Down'],
            4: ['NumpadLeft', 'Left'],
            6: ['NumpadRight', 'Right'],
            7: ['NumpadHome', 'Home'],
            9: ['NumpadPageUp', 'PageUp'],
            1: ['NumpadEnd', 'End'],
            3: ['NumpadPageDown', 'PageDown'],
            0: ['NumpadInsert', 'Insert'],
            5: ['NumpadClear', 'Clear']
          };
          const mapped = arrowByNum[Number(m[1])];
          if (mapped) candidates.push(...mapped);
        }
        if (String(normalizedKey).toLowerCase() === 'numadd') candidates.push('+');
        if (String(normalizedKey).toLowerCase() === 'numsub') candidates.push('-');
        if (String(normalizedKey).toLowerCase() === 'numdiv') candidates.push('/');
        if (String(normalizedKey).toLowerCase() === 'nummult') candidates.push('*');
        return [...new Set(candidates)];
      })();

      const callback = () => {
        const isEnabled = overlayWindow && !overlayWindow.isDestroyed();
        const nextEnabled = !isEnabled;
        if (nextEnabled) createOverlayWindow();
        else destroyOverlayWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('overlay:toggle-state-changed', nextEnabled);
        }
      };

      const modifierSets = (() => {
        const sets = [modifiers];
        if (process.platform === 'win32' && modifiers.includes('CommandOrControl')) {
          sets.push(modifiers.map((m) => (m === 'CommandOrControl' ? 'Control' : m)));
        }
        return sets.map((set) => [...new Set(set)]);
      })();

      let registeredAccelerator = '';
      for (const modSet of modifierSets) {
        for (const keyVariant of keyCandidates) {
          const electronHotkey = [...new Set([...modSet, keyVariant])].join('+');
          const success = globalShortcut.register(electronHotkey, callback);
          if (success) {
            registeredAccelerator = electronHotkey;
            break;
          }
        }
        if (registeredAccelerator) {
          break;
        }
      }

      if (registeredAccelerator) {
        currentOverlayHotkey = registeredAccelerator;
        console.log('Registered overlay hotkey:', registeredAccelerator);
      } else {
        console.warn('Failed to register overlay hotkey:', hotkey);
      }
    } catch (error) {
      console.error('Error registering overlay hotkey:', error);
    }
  }
}

function unregisterOverlayHotkey() {
  if (currentOverlayHotkey) {
    globalShortcut.unregister(currentOverlayHotkey);
    currentOverlayHotkey = null;
    console.log('Unregistered overlay hotkey');
  }
}

ipcMain.on('overlay:update', (_event, payload) => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  try {
    applyOverlayCompatibility();
    overlayWindow.webContents.send('overlay:update', payload);
    const bounds = overlayWindow.getBounds();
    const targetWidth = payload.width || bounds.width;
    const targetHeight = payload.height || bounds.height;

    const settings = payload.settings || {};
    const hasCustomPosition = settings.customPositionEnabled === true
      && Number.isFinite(Number(settings.customX))
      && Number.isFinite(Number(settings.customY));

    if (hasCustomPosition) {
      const x = Math.round(Number(settings.customX));
      const y = Math.round(Number(settings.customY));
      overlayWindow.setBounds({ x, y, width: targetWidth, height: targetHeight });
      applyOverlayCompatibility();
    } else if (payload.position) {
      const display = getOverlayDisplay(payload.settings?.displayId).workArea;
      const margin = 1;
      const topMargin = 0;
      const position = String(payload.position || 'top-right');
      let x = display.x + margin;
      let y = display.y + margin;

      switch (position) {
        case 'top-right':
          x = display.x + Math.max(0, display.width - targetWidth - margin);
          y = display.y + topMargin;
          break;
        case 'bottom-left':
          x = display.x + margin;
          y = display.y + Math.max(0, display.height - targetHeight - margin);
          break;
        case 'bottom-right':
          x = display.x + Math.max(0, display.width - targetWidth - margin);
          y = display.y + Math.max(0, display.height - targetHeight - margin);
          break;
        case 'top-left':
        default:
          x = display.x + margin;
          y = display.y + topMargin;
          break;
      }

      overlayWindow.setBounds({ x, y, width: targetWidth, height: targetHeight });
      applyOverlayCompatibility();
    } else if (targetHeight !== bounds.height) {
      overlayWindow.setSize(targetWidth, targetHeight);
    }
  } catch (e) {
    console.error('Failed to forward overlay payload:', e);
  }
});

ipcMain.on('overlay:resize', (_event, payload) => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  try {
    applyOverlayCompatibility();
    const bounds = overlayWindow.getBounds();
    const targetWidth = Number.isFinite(payload.width) ? payload.width : bounds.width;
    const targetHeight = Number.isFinite(payload.height) ? payload.height : bounds.height;
    const settings = payload.settings || {};
    const hasCustomPosition = settings.customPositionEnabled === true
      && Number.isFinite(Number(settings.customX))
      && Number.isFinite(Number(settings.customY));

    if (hasCustomPosition) {
      const x = Math.round(Number(settings.customX));
      const y = Math.round(Number(settings.customY));
      overlayWindow.setBounds({ x, y, width: targetWidth, height: targetHeight });
      applyOverlayCompatibility();
    } else if (payload.position) {
      const display = getOverlayDisplay(payload.settings?.displayId).workArea;
      const margin = 1;
      const topMargin = 0;
      const position = String(payload.position || 'top-right');
      let x = display.x + margin;
      let y = display.y + margin;

      switch (position) {
        case 'top-right':
          x = display.x + Math.max(0, display.width - targetWidth - margin);
          y = display.y + topMargin;
          break;
        case 'bottom-left':
          x = display.x + margin;
          y = display.y + Math.max(0, display.height - targetHeight - margin);
          break;
        case 'bottom-right':
          x = display.x + Math.max(0, display.width - targetWidth - margin);
          y = display.y + Math.max(0, display.height - targetHeight - margin);
          break;
        case 'top-left':
        default:
          x = display.x + margin;
          y = display.y + topMargin;
          break;
      }

      overlayWindow.setBounds({ x, y, width: targetWidth, height: targetHeight });
      applyOverlayCompatibility();
    } else if (targetWidth !== bounds.width || targetHeight !== bounds.height) {
      overlayWindow.setSize(targetWidth, targetHeight);
    }
  } catch (e) {
    console.error('Failed to resize overlay window:', e);
  }
});

ipcMain.on('overlay:drag-begin', (_event, payload) => {
  if (!overlayDragUnlockEnabled || !overlayWindow || overlayWindow.isDestroyed()) return;
  const startMouseX = Number(payload?.screenX);
  const startMouseY = Number(payload?.screenY);
  if (!Number.isFinite(startMouseX) || !Number.isFinite(startMouseY)) return;
  const bounds = overlayWindow.getBounds();
  overlayDragSession = {
    startMouseX,
    startMouseY,
    startX: bounds.x,
    startY: bounds.y
  };
});

ipcMain.on('overlay:drag-move', (_event, payload) => {
  if (!overlayDragUnlockEnabled || !overlayDragSession || !overlayWindow || overlayWindow.isDestroyed()) return;
  const moveMouseX = Number(payload?.screenX);
  const moveMouseY = Number(payload?.screenY);
  if (!Number.isFinite(moveMouseX) || !Number.isFinite(moveMouseY)) return;
  const dx = Math.round(moveMouseX - overlayDragSession.startMouseX);
  const dy = Math.round(moveMouseY - overlayDragSession.startMouseY);
  const currentBounds = overlayWindow.getBounds();
  const nextX = overlayDragSession.startX + dx;
  const nextY = overlayDragSession.startY + dy;
  const snappedX = Math.round(nextX / OVERLAY_DRAG_SNAP_PX) * OVERLAY_DRAG_SNAP_PX;
  const snappedY = Math.round(nextY / OVERLAY_DRAG_SNAP_PX) * OVERLAY_DRAG_SNAP_PX;
  overlayWindow.setBounds({
    x: snappedX,
    y: snappedY,
    width: currentBounds.width,
    height: currentBounds.height
  });
});

ipcMain.on('overlay:drag-end', () => {
  if (!overlayDragSession || !overlayWindow || overlayWindow.isDestroyed()) {
    overlayDragSession = null;
    return;
  }
  const bounds = overlayWindow.getBounds();
  overlayDragSession = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('overlay:position-changed', { x: bounds.x, y: bounds.y });
  }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  appBehaviorSettings = loadBehaviorSettings();
  applyLoginItemSettings();
  syncTrayState();
  createWindow();
  setupAutoUpdater();
  // Start Discord Rich Presence if available
  try { initDiscordRPC(); } catch (e) { /* ignore */ }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (appBehaviorSettings.closeToTray) {
      return;
    }
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    showMainWindow();
  }
});

app.on('will-quit', () => {
  clearDiscordIntervals();
  if (discordIpc) {
    try { discordIpc.clearActivity(); } catch (e) { /* ignore */ }
    try { discordIpc.disconnect(); } catch (e) { /* ignore */ }
  }
});

ipcMain.handle('app-behavior:get', () => {
  return appBehaviorSettings;
});

ipcMain.handle('app-behavior:set', (_event, nextSettings) => {
  const merged = {
    ...appBehaviorSettings,
    ...normalizeBehaviorSettings(nextSettings)
  };
  const saved = saveBehaviorSettings(merged);
  applyLoginItemSettings();
  syncTrayState();
  // Start/stop Discord Rich Presence based on the saved setting
  try {
    if (saved.enableDiscordRichPresence) {
      initDiscordRPC();
    } else {
      clearDiscordIntervals();
      sendDiscordPresenceStatus({ enabled: false, connected: false });
      if (discordIpc) {
        try { discordIpc.clearActivity(); } catch (e) { /* ignore */ }
        try { discordIpc.disconnect(); } catch (e) { /* ignore */ }
      }
    }
  } catch (e) {
    // ignore
  }

  return saved;
});

ipcMain.handle('app-update:check', async () => {
  const packageJson = readLocalPackageJson();
  const fallbackReleaseUrl = getLatestReleaseUrl(packageJson?.repository);

  if (isAutoUpdaterSupported()) {
    setupAutoUpdater();
    try {
      const checkResult = await autoUpdater.checkForUpdates();
      const latestVersion = String(checkResult?.updateInfo?.version || '').trim();
      const updateAvailable = latestVersion
        ? compareVersions(app.getVersion(), latestVersion) < 0
        : false;

      return {
        ok: true,
        configured: true,
        source: 'electron-updater',
        usingAutoUpdater: true,
        currentVersion: app.getVersion(),
        latestVersion,
        updateAvailable,
        releaseUrl: fallbackReleaseUrl,
        releaseTitle: String(checkResult?.updateInfo?.releaseName || checkResult?.updateInfo?.releaseTitle || checkResult?.updateInfo?.name || '').trim(),
        releaseNotes: String(checkResult?.updateInfo?.releaseNotes || '').trim(),
        message: updateAvailable
          ? (latestVersion
            ? `Update available: ${latestVersion}.`
            : 'Update available.')
          : 'No Updates Found'
      };
    } catch (error) {
      if (isMissingLatestYmlError(error)) {
        const fallback = await checkForAppUpdates();
        return {
          ...fallback,
          usingAutoUpdater: false,
          manualDownloadOnly: true,
          releaseUrl: String(fallback?.releaseUrl || fallbackReleaseUrl || '').trim(),
          warning: 'GitHub release is missing latest.yml, so in-app download is unavailable. Use Open Latest Release.'
        };
      }
      return {
        ok: false,
        configured: true,
        source: 'electron-updater',
        usingAutoUpdater: true,
        currentVersion: app.getVersion(),
        releaseUrl: fallbackReleaseUrl,
        error: `Auto update check failed: ${error.message}`
      };
    }
  }

  return checkForAppUpdates();
});

ipcMain.handle('app-update:download', async () => {
  if (!isAutoUpdaterSupported()) {
    return { ok: false, error: 'In-app download is only available in packaged builds.' };
  }

  setupAutoUpdater();

  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (error) {
    if (isMissingLatestYmlError(error)) {
      return {
        ok: false,
        code: 'missing-latest-yml',
        error: 'In-app download is unavailable because latest.yml is missing from release assets. Use Open Latest Release.'
      };
    }
    return { ok: false, error: `Failed to start update download: ${error.message}` };
  }
});

ipcMain.handle('app-update:quit-and-install', async () => {
  if (!isAutoUpdaterSupported()) {
    return { ok: false, error: 'Auto update install is only available in packaged builds.' };
  }

  if (!updateDownloadedInfo) {
    return { ok: false, error: 'No downloaded update is ready to install yet.' };
  }

  try {
    isQuitting = true;
    setImmediate(() => {
      autoUpdater.quitAndInstall(false, true);
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('app-update:open-url', async (_event, targetUrl) => {
  const url = String(targetUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'Invalid update URL.' };
  }

  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});
