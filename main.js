const { app, BrowserWindow, Menu, Tray, ipcMain, shell } = require('electron');
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
const DISCORD_ACTIVITY_INTERVAL_MS = 15_000;
const DISCORD_RECONNECT_INTERVAL_MS = 15_000;

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