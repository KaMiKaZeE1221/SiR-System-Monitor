const { app, BrowserWindow, Menu, Tray, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const enableGpuAcceleration = process.env.SIR_ENABLE_GPU_ACCELERATION === '1';
if (!enableGpuAcceleration) {
  app.disableHardwareAcceleration();
}

const APP_BEHAVIOR_SETTINGS_FILE = 'appBehaviorSettings.json';
const AUTO_LAUNCH_ARG = '--sir-auto-launch';
const DEFAULT_APP_BEHAVIOR_SETTINGS = {
  launchAtStartup: false,
  startMinimized: false,
  minimizeToTray: false,
  closeToTray: false
};

let mainWindow = null;
let tray = null;
let isQuitting = false;
let appBehaviorSettings = { ...DEFAULT_APP_BEHAVIOR_SETTINGS };
const launchedFromAutoStart = process.argv.includes(AUTO_LAUNCH_ARG);

function getBehaviorSettingsPath() {
  return path.join(app.getPath('userData'), APP_BEHAVIOR_SETTINGS_FILE);
}

function normalizeBehaviorSettings(settings) {
  return {
    launchAtStartup: !!settings?.launchAtStartup,
    startMinimized: !!settings?.startMinimized,
    minimizeToTray: !!settings?.minimizeToTray,
    closeToTray: !!settings?.closeToTray
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
      path: process.execPath,
      args: [AUTO_LAUNCH_ARG]
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
  tray = new Tray(path.join(__dirname, 'SiR_SM.ico'));
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

function syncTrayState() {
  if (appBehaviorSettings.minimizeToTray || appBehaviorSettings.closeToTray) {
    createTray();
    return;
  }
  destroyTrayIfUnused();
}

function createWindow() {
  const forceStartMinimized = launchedFromAutoStart && appBehaviorSettings.launchAtStartup;

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    icon: path.join(__dirname, 'SiR_SM.ico'),
    autoHideMenuBar: true,
    show: !(appBehaviorSettings.startMinimized || forceStartMinimized),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.setMenuBarVisibility(false);

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

  if (appBehaviorSettings.startMinimized || forceStartMinimized) {
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
  return saved;
});