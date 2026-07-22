const { app, BrowserWindow, Menu, Tray, ipcMain, shell, screen, globalShortcut, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const os = require('os');
const { execFile, spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');
const { summarizeElectronAppMetrics } = require('./appTelemetry');
const { getDiagnosticDefinition, listPublicDiagnostics } = require('./diagnosticsCatalog');
const { createSupportZip, sanitizeSupportText, sanitizeSupportValue } = require('./supportBundle');
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

app.setName('SiR System Monitor');
if (process.platform === 'win32') {
  app.setAppUserModelId('com.sir.systemmonitor');
}

const APP_BEHAVIOR_SETTINGS_FILE = 'appBehaviorSettings.json';
const FORCE_ADMIN_ARGUMENT = '--sir-require-admin';
const ELEVATION_RELAUNCH_ARGUMENT = '--sir-elevation-relaunch-attempted';
const INSTALL_HARDWARE_ACCESS_DRIVER_ARGUMENT = '--sir-install-hardware-access-driver';
const DEFAULT_APP_BEHAVIOR_SETTINGS = {
  launchAtStartup: false,
  launchAsAdministrator: false,
  startMinimized: false,
  minimizeToTray: false,
  closeToTray: false,
  autoCheckForUpdates: true,
  startupDelaySeconds: 0,
  enableDiscordRichPresence: true
};
const AUTO_UPDATE_PROVIDER = Object.freeze({
  provider: 'github',
  owner: 'KaMiKaZeE1221',
  repo: 'SiR-System-Monitor'
});
const AUTO_UPDATE_CONFIG_YAML = [
  `owner: ${AUTO_UPDATE_PROVIDER.owner}`,
  `repo: ${AUTO_UPDATE_PROVIDER.repo}`,
  `provider: ${AUTO_UPDATE_PROVIDER.provider}`,
  'updaterCacheDirName: sir-system-monitor-updater',
  ''
].join('\n');

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
let elevationRestartInProgress = false;
let hardwareAccessLastError = '';
let startupRevealTimer = null;
let startupRevealHandled = false;
let startupWindowOpenedByUser = false;
let activeDiagnosticRun = null;
let diagnosticRunCounter = 0;

const DIAGNOSTIC_OUTPUT_LIMIT_BYTES = 1024 * 1024;

function isRunningAsAdministrator() {
  if (process.platform !== 'win32') return false;
  try {
    const koffi = require('koffi');
    const shell32 = koffi.load('shell32.dll');
    const isUserAnAdmin = shell32.func('bool IsUserAnAdmin()');
    return isUserAnAdmin() === true;
  } catch (error) {
    console.warn('Unable to determine administrator status:', error.message);
    return false;
  }
}

function formatDiagnosticMegabytes(bytes) {
  const numeric = Number(bytes);
  if (!Number.isFinite(numeric) || numeric < 0) return 'Unavailable';
  return `${(numeric / 1024 / 1024).toFixed(1)} MB`;
}

function formatDiagnosticGigabytes(bytes) {
  const numeric = Number(bytes);
  if (!Number.isFinite(numeric) || numeric < 0) return 'Unavailable';
  return `${(numeric / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatGpuIdentifier(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `0x${Math.max(0, numeric).toString(16).padStart(4, '0').toUpperCase()}` : 'Unknown';
}

async function buildSystemDiagnosticReport() {
  const processMetrics = app.getAppMetrics();
  const windows = BrowserWindow.getAllWindows();
  const runtime = summarizeElectronAppMetrics(processMetrics, {
    windowCount: windows.length,
    visibleWindowCount: windows.filter((window) => !window.isDestroyed() && window.isVisible()).length,
    uptimeSeconds: process.uptime()
  });
  const cpus = os.cpus();
  const displays = screen.getAllDisplays();
  let gpuInfo = {};
  try {
    gpuInfo = await app.getGPUInfo('basic');
  } catch (error) {
    gpuInfo = { error: error.message };
  }

  const lines = [
    'SiR System Monitor - System & App Diagnostic Report',
    `Generated: ${new Date().toISOString()}`,
    '',
    '[Application]',
    `Version: ${app.getVersion()}`,
    `Packaged build: ${app.isPackaged ? 'Yes' : 'No'}`,
    `Running as administrator: ${isRunningAsAdministrator() ? 'Yes' : 'No'}`,
    `Hardware acceleration enabled: ${enableGpuAcceleration ? 'Yes' : 'No'}`,
    `Uptime: ${runtime.uptimeSeconds.toFixed(1)} seconds`,
    `Electron processes: ${runtime.processCount}`,
    `Renderer processes: ${runtime.rendererProcessCount}`,
    `Utility processes: ${runtime.utilityProcessCount}`,
    `GPU processes: ${runtime.gpuProcessCount}`,
    `Private memory (Task Manager comparable): ${formatDiagnosticMegabytes(runtime.privateBytes)}`,
    `Working set (includes shared pages): ${formatDiagnosticMegabytes(runtime.workingSetBytes)}`,
    `Peak working set: ${formatDiagnosticMegabytes(runtime.peakWorkingSetBytes)}`,
    `Aggregate CPU usage: ${runtime.cpuPercent.toFixed(2)}%`,
    `Windows: ${runtime.windowCount} total, ${runtime.visibleWindowCount} visible`,
    '',
    '[Windows & Hardware]',
    `Platform: ${os.type()} ${os.release()} (${os.arch()})`,
    `OS version: ${typeof os.version === 'function' ? os.version() : 'Unavailable'}`,
    `CPU: ${cpus[0] && cpus[0].model ? cpus[0].model.trim() : 'Unavailable'}`,
    `Logical processors: ${cpus.length}`,
    `System memory: ${formatDiagnosticGigabytes(os.totalmem())} total, ${formatDiagnosticGigabytes(os.freemem())} free`,
    '',
    '[Displays]'
  ];

  displays.forEach((display, index) => {
    const bounds = display.bounds || {};
    lines.push(`Display ${index + 1}: ${display.label || display.id || 'Unknown'} | ${bounds.width || 0}x${bounds.height || 0} @ ${Number(display.scaleFactor || 1).toFixed(2)}x | ${display.internal ? 'Internal' : 'External'}`);
  });

  lines.push('', '[GPU Devices]');
  const gpuDevices = Array.isArray(gpuInfo.gpuDevice) ? gpuInfo.gpuDevice : [];
  if (!gpuDevices.length) {
    lines.push(gpuInfo.error ? `GPU information unavailable: ${gpuInfo.error}` : 'No GPU devices reported.');
  } else {
    gpuDevices.forEach((device, index) => {
      lines.push(`GPU ${index + 1}: vendor ${formatGpuIdentifier(device.vendorId)}, device ${formatGpuIdentifier(device.deviceId)}, driver ${device.driverVendor || 'Unknown'} ${device.driverVersion || ''}`.trim());
    });
  }

  lines.push('', '[Electron Process Detail]');
  processMetrics.forEach((metric) => {
    lines.push(`${metric.type || 'Unknown'} PID ${metric.pid}: CPU ${Number(metric.cpu && metric.cpu.percentCPUUsage || 0).toFixed(2)}%, private ${formatDiagnosticMegabytes(Number(metric.memory && metric.memory.privateBytes || 0) * 1024)}, working set ${formatDiagnosticMegabytes(Number(metric.memory && metric.memory.workingSetSize || 0) * 1024)}`);
  });

  lines.push('', '[GPU Feature Status]', JSON.stringify(app.getGPUFeatureStatus(), null, 2));
  return lines.join('\n');
}

function sendDiagnosticEvent(sender, channel, payload) {
  if (!sender || sender.isDestroyed()) return;
  sender.send(channel, payload);
}

function runDiagnosticScript(sender, definition) {
  if (activeDiagnosticRun) {
    return { ok: false, error: `A diagnostic is already running: ${activeDiagnosticRun.label}` };
  }

  const scriptPath = path.join(app.getAppPath(), 'scripts', definition.script);
  if (!fs.existsSync(scriptPath)) {
    return { ok: false, error: `The bundled diagnostic script is missing: ${definition.script}` };
  }

  const runId = `${Date.now()}-${++diagnosticRunCounter}`;
  const child = spawn(process.execPath, [scriptPath, ...(definition.args || [])], {
    cwd: app.isPackaged ? process.resourcesPath : __dirname,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      SIR_DIAGNOSTIC_RUN: '1'
    }
  });

  const state = {
    runId,
    id: definition.id,
    label: definition.label,
    child,
    bytesSent: 0,
    outputTruncated: false,
    timedOut: false,
    cancelRequested: false,
    finished: false,
    timeout: null
  };
  activeDiagnosticRun = state;

  const emitOutput = (stream, rawChunk) => {
    if (state.outputTruncated) return;
    const chunk = String(rawChunk || '');
    const remaining = DIAGNOSTIC_OUTPUT_LIMIT_BYTES - state.bytesSent;
    if (remaining <= 0) {
      state.outputTruncated = true;
      sendDiagnosticEvent(sender, 'diagnostics:output', { runId, stream: 'system', chunk: '\n[Output truncated at 1 MB.]\n' });
      return;
    }
    const buffer = Buffer.from(chunk, 'utf8');
    const accepted = buffer.length > remaining ? buffer.subarray(0, remaining).toString('utf8') : chunk;
    state.bytesSent += Buffer.byteLength(accepted, 'utf8');
    sendDiagnosticEvent(sender, 'diagnostics:output', { runId, stream, chunk: accepted });
    if (buffer.length > remaining) {
      state.outputTruncated = true;
      sendDiagnosticEvent(sender, 'diagnostics:output', { runId, stream: 'system', chunk: '\n[Output truncated at 1 MB.]\n' });
    }
  };

  const finish = (exitCode, errorMessage = '') => {
    if (state.finished) return;
    state.finished = true;
    if (state.timeout) clearTimeout(state.timeout);
    if (activeDiagnosticRun === state) activeDiagnosticRun = null;
    const cancelled = state.cancelRequested;
    const success = !cancelled && !state.timedOut && !errorMessage && Number(exitCode) === 0;
    sendDiagnosticEvent(sender, 'diagnostics:complete', {
      runId,
      id: definition.id,
      label: definition.label,
      success,
      cancelled,
      timedOut: state.timedOut,
      exitCode: Number.isFinite(Number(exitCode)) ? Number(exitCode) : null,
      error: errorMessage
    });
  };

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => emitOutput('stdout', chunk));
  child.stderr.on('data', (chunk) => emitOutput('stderr', chunk));
  child.once('error', (error) => finish(null, error.message));
  child.once('close', (code) => finish(code));

  state.timeout = setTimeout(() => {
    if (state.finished) return;
    state.timedOut = true;
    emitOutput('system', `\n[Diagnostic timed out after ${Math.round(definition.timeoutMs / 1000)} seconds.]\n`);
    try { child.kill(); } catch (error) {}
  }, definition.timeoutMs);

  return { ok: true, runId, id: definition.id, label: definition.label };
}

function quoteWindowsArgument(value) {
  const text = String(value || '');
  return `"${text.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
}

function launchElevatedApp(additionalArguments = []) {
  if (process.platform !== 'win32') {
    return Promise.reject(new Error('Administrator restart is only available on Windows.'));
  }

  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const powershellPath = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const restartArgumentList = [];
  if (!app.isPackaged) restartArgumentList.push(app.getAppPath());
  restartArgumentList.push(...additionalArguments.filter(Boolean));
  const restartArguments = restartArgumentList.map(quoteWindowsArgument).join(' ');
  const script = [
    '$startInfo = New-Object System.Diagnostics.ProcessStartInfo',
    '$startInfo.FileName = $env:SIR_ELEVATED_EXECUTABLE',
    '$startInfo.Arguments = $env:SIR_ELEVATED_ARGUMENTS',
    '$startInfo.UseShellExecute = $true',
    "$startInfo.Verb = 'runas'",
    '$null = [System.Diagnostics.Process]::Start($startInfo)'
  ].join('; ');

  return new Promise((resolve, reject) => {
    execFile(
      powershellPath,
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
      {
        windowsHide: true,
        timeout: 120000,
        env: {
          ...process.env,
          SIR_ELEVATED_EXECUTABLE: process.execPath,
          SIR_ELEVATED_ARGUMENTS: restartArguments
        }
      },
      (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      }
    );
  });
}

function compareVersionParts(left, right) {
  const leftParts = String(left || '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = String(right || '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index++) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function queryPawnIoRegistryVersion(registryView) {
  if (process.platform !== 'win32') return Promise.resolve('');
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const regPath = path.join(systemRoot, 'System32', 'reg.exe');
  const registryKey = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PawnIO';

  return new Promise((resolve) => {
    execFile(
      regPath,
      ['query', registryKey, '/v', 'DisplayVersion', `/reg:${registryView}`],
      { windowsHide: true, timeout: 5000 },
      (error, stdout = '') => {
        if (error) {
          resolve('');
          return;
        }
        const match = String(stdout).match(/DisplayVersion\s+REG_\w+\s+([^\r\n]+)/i);
        resolve(match ? String(match[1]).trim() : '');
      }
    );
  });
}

function resolveHardwareAccessDriverInstallerPath() {
  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'sensor-host', 'PawnIO_setup.exe'));
  }
  candidates.push(path.join(__dirname, 'sensor-host', 'bin', 'PawnIO_setup.exe'));
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

async function getHardwareAccessDriverStatus() {
  const versions = await Promise.all([
    queryPawnIoRegistryVersion('64'),
    queryPawnIoRegistryVersion('32')
  ]);
  const version = versions.find(Boolean) || '';
  return {
    installed: !!version,
    compatible: !!version && compareVersionParts(version, '2.0.0') >= 0,
    version,
    installerAvailable: !!resolveHardwareAccessDriverInstallerPath(),
    error: hardwareAccessLastError
  };
}

async function installHardwareAccessDriverIfRequired() {
  const currentStatus = await getHardwareAccessDriverStatus();
  if (currentStatus.compatible) return currentStatus;

  const installerPath = resolveHardwareAccessDriverInstallerPath();
  if (!installerPath) {
    throw new Error('The bundled hardware access driver installer is missing. Reinstall SiR System Monitor.');
  }

  await new Promise((resolve, reject) => {
    execFile(
      installerPath,
      ['-install'],
      { windowsHide: true, timeout: 120000 },
      (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      }
    );
  });

  const installedStatus = await getHardwareAccessDriverStatus();
  if (!installedStatus.compatible) {
    throw new Error('The hardware access driver installer completed, but a compatible PawnIO installation was not detected.');
  }
  return installedStatus;
}

function isMissingLatestYmlError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('cannot find latest.yml') || message.includes('latest.yml') && message.includes('404');
}

function isMissingLocalUpdateConfigError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('app-update.yml') &&
    (message.includes('enoent') || message.includes('no such file or directory'));
}

function isAutoUpdaterSupported() {
  return !!autoUpdater && app.isPackaged;
}

function configureAutoUpdaterFeed() {
  if (!isAutoUpdaterSupported()) return;

  const packagedConfigPath = path.join(process.resourcesPath, 'app-update.yml');
  if (fs.existsSync(packagedConfigPath)) return;

  // A prepackaged electron-builder run can skip its normal afterPack metadata
  // generation. Keep checks and downloads functional from a writable fallback
  // while the build also ships a static copy in resources.
  try {
    const fallbackConfigPath = path.join(app.getPath('userData'), 'app-update-fallback.yml');
    fs.mkdirSync(path.dirname(fallbackConfigPath), { recursive: true });
    fs.writeFileSync(fallbackConfigPath, AUTO_UPDATE_CONFIG_YAML, 'utf8');
    autoUpdater.updateConfigPath = fallbackConfigPath;
  } catch (error) {
    console.warn('Unable to create fallback updater configuration:', error.message);
  }

  // setFeedURL lets update checks proceed even if the fallback file could not be
  // written. Downloads will use the fallback file's updater cache metadata when
  // it is available.
  autoUpdater.setFeedURL(AUTO_UPDATE_PROVIDER);
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

  configureAutoUpdaterFeed();
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
    const isMissingLocalConfig = isMissingLocalUpdateConfigError(error);
    sendUpdateStatus({
      state: 'error',
      currentVersion: app.getVersion(),
      code: isMissingMetadata
        ? 'missing-latest-yml'
        : (isMissingLocalConfig ? 'missing-app-update-config' : 'auto-updater-error'),
      error: isMissingMetadata
        ? 'In-app auto update is unavailable because latest.yml is missing from the GitHub release assets.'
        : (isMissingLocalConfig
          ? 'The installed updater configuration is missing. GitHub release checking will be used instead.'
          : (error?.message || 'Unknown updater error.'))
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
  const startupDelaySeconds = Number.isFinite(Number(settings?.startupDelaySeconds))
    ? Math.max(0, Math.min(60, Math.round(Number(settings.startupDelaySeconds))))
    : 0;

  return {
    launchAtStartup: !!settings?.launchAtStartup,
    launchAsAdministrator: !!settings?.launchAsAdministrator,
    startMinimized: !!settings?.startMinimized,
    minimizeToTray: !!settings?.minimizeToTray,
    closeToTray: !!settings?.closeToTray,
    autoCheckForUpdates: settings?.autoCheckForUpdates !== false,
    startupDelaySeconds,
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
  startupWindowOpenedByUser = true;
  startupRevealHandled = true;
  if (startupRevealTimer) {
    clearTimeout(startupRevealTimer);
    startupRevealTimer = null;
  }
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
    const appVersion = String(app.getVersion() || '').trim() || 'unknown';
    // Updated presence payload per provided example
    discordIpc.setActivity({
      details: 'Monitoring System Stats',
      state: `v${appVersion}`,
      startTimestamp: Math.floor(Date.now() / 1000),
      largeImageKey: 'sir_sm_circle',
      largeImageText: 'Numbani',
      smallImageKey: 'sir_sm_circle',
      smallImageText: `v${appVersion}`,
      partyMax: 5000,
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
  const startupDelayMs = Math.max(0, Math.min(60000, Number(appBehaviorSettings.startupDelaySeconds || 0) * 1000));
  startupRevealHandled = false;
  startupWindowOpenedByUser = false;
  if (startupRevealTimer) {
    clearTimeout(startupRevealTimer);
    startupRevealTimer = null;
  }
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    icon: path.join(__dirname, 'SiR_SM_Circle.ico'),
    autoHideMenuBar: true,
    show: false,
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
    if (startupRevealTimer) {
      clearTimeout(startupRevealTimer);
      startupRevealTimer = null;
    }
    shutdownOverlaySubsystem();
    mainWindow = null;
  });

  const applyAutomaticStartupVisibility = () => {
    startupRevealTimer = null;
    if (startupRevealHandled || startupWindowOpenedByUser || !mainWindow || mainWindow.isDestroyed()) return;
    startupRevealHandled = true;

    if (appBehaviorSettings.startMinimized && appBehaviorSettings.minimizeToTray) {
      mainWindow.hide();
      return;
    }

    mainWindow.show();
    if (appBehaviorSettings.startMinimized) mainWindow.minimize();
  };

  // DOM readiness happens before asynchronous sensor discovery. Waiting for
  // ready-to-show made visibility depend on the first fully painted sensor set
  // and could later re-minimize a window the user had already opened manually.
  mainWindow.webContents.once('dom-ready', () => {
    if (startupRevealHandled || startupWindowOpenedByUser) return;
    if (startupDelayMs > 0) {
      startupRevealTimer = setTimeout(applyAutomaticStartupVisibility, startupDelayMs);
      return;
    }
    applyAutomaticStartupVisibility();
  });
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

function shutdownOverlaySubsystem() {
  overlayDragSession = null;
  destroyOverlayWindow();
  unregisterOverlayHotkey();
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
    overlayWindow.webContents.send('overlay:update', payload);
  } catch (e) {
    console.error('Failed to forward overlay payload:', e);
  }
});

ipcMain.on('overlay:resize', (_event, payload) => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  try {
    applyOverlayCompatibility();
    const bounds = overlayWindow.getBounds();
    const requestedWidth = Number(payload && payload.width);
    const requestedHeight = Number(payload && payload.height);
    const settings = payload.settings || {};
    const targetDisplay = getOverlayDisplay(settings.displayId).workArea;
    const maximumDisplayWidth = Math.max(260, targetDisplay.width - 2);
    const targetWidth = Number.isFinite(requestedWidth) ? Math.max(260, Math.min(maximumDisplayWidth, Math.round(requestedWidth))) : bounds.width;
    const targetHeight = Number.isFinite(requestedHeight) ? Math.max(60, Math.min(1400, Math.round(requestedHeight))) : bounds.height;
    const hasCustomPosition = settings.customPositionEnabled === true
      && Number.isFinite(Number(settings.customX))
      && Number.isFinite(Number(settings.customY));

    if (hasCustomPosition) {
      const x = Math.round(Number(settings.customX));
      const y = Math.round(Number(settings.customY));
      overlayWindow.setBounds({ x, y, width: targetWidth, height: targetHeight });
      applyOverlayCompatibility();
    } else if (payload.position) {
      const display = targetDisplay;
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

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  appBehaviorSettings = loadBehaviorSettings();
  const forceAdministrator = process.argv.includes(FORCE_ADMIN_ARGUMENT);
  const installHardwareAccessDriver = process.argv.includes(INSTALL_HARDWARE_ACCESS_DRIVER_ARGUMENT);
  const elevationAlreadyAttempted = process.argv.includes(ELEVATION_RELAUNCH_ARGUMENT);
  const shouldElevate = forceAdministrator || installHardwareAccessDriver || appBehaviorSettings.launchAsAdministrator;
  const runningAsAdministrator = isRunningAsAdministrator();
  if (shouldElevate && !runningAsAdministrator && !elevationAlreadyAttempted) {
    try {
      await launchElevatedApp([
        ...(forceAdministrator ? [FORCE_ADMIN_ARGUMENT] : []),
        ...(installHardwareAccessDriver ? [INSTALL_HARDWARE_ACCESS_DRIVER_ARGUMENT] : []),
        ELEVATION_RELAUNCH_ARGUMENT
      ]);
      isQuitting = true;
      app.quit();
      return;
    } catch (error) {
      console.warn('Administrator launch was cancelled or failed:', error.message);
      if (forceAdministrator) {
        isQuitting = true;
        app.quit();
        return;
      }
    }
  }
  if ((forceAdministrator || installHardwareAccessDriver) && !runningAsAdministrator) {
    console.warn('The forced administrator launch did not obtain administrator privileges.');
    isQuitting = true;
    app.quit();
    return;
  }
  if (installHardwareAccessDriver) {
    try {
      await installHardwareAccessDriverIfRequired();
      hardwareAccessLastError = '';
    } catch (error) {
      hardwareAccessLastError = String(error && error.message ? error.message : error);
      console.warn('Unable to install the hardware access driver:', hardwareAccessLastError);
    }
  }
  applyLoginItemSettings();
  syncTrayState();
  createWindow();
  setupAutoUpdater();
  // Start Discord Rich Presence if available
  try { initDiscordRPC(); } catch (e) { /* ignore */ }
});

app.on('before-quit', () => {
  isQuitting = true;
  shutdownOverlaySubsystem();
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
  shutdownOverlaySubsystem();
  if (activeDiagnosticRun && activeDiagnosticRun.child) {
    activeDiagnosticRun.cancelRequested = true;
    try { activeDiagnosticRun.child.kill(); } catch (error) {}
  }
  clearDiscordIntervals();
  if (discordIpc) {
    try { discordIpc.clearActivity(); } catch (e) { /* ignore */ }
    try { discordIpc.disconnect(); } catch (e) { /* ignore */ }
  }
});

ipcMain.handle('app:restart-elevated', async (_event, options = {}) => {
  if (elevationRestartInProgress) {
    return { ok: false, error: 'An administrator restart is already in progress.' };
  }

  elevationRestartInProgress = true;
  const enableAdministratorLaunch = options && options.enableLaunchAsAdministrator === true;
  const previousBehaviorSettings = { ...appBehaviorSettings };
  try {
    if (enableAdministratorLaunch && !appBehaviorSettings.launchAsAdministrator) {
      saveBehaviorSettings({ ...appBehaviorSettings, launchAsAdministrator: true });
      applyLoginItemSettings();
    }
    await launchElevatedApp([
      ...(options && options.installHardwareAccessDriver === true ? [INSTALL_HARDWARE_ACCESS_DRIVER_ARGUMENT] : []),
      ELEVATION_RELAUNCH_ARGUMENT
    ]);
    setTimeout(() => {
      isQuitting = true;
      app.quit();
    }, 350);
    return { ok: true, settings: appBehaviorSettings };
  } catch (error) {
    if (enableAdministratorLaunch) {
      saveBehaviorSettings(previousBehaviorSettings);
      applyLoginItemSettings();
    }
    elevationRestartInProgress = false;
    const message = String(error && error.message ? error.message : error || 'Administrator restart was cancelled.');
    return {
      ok: false,
      settings: appBehaviorSettings,
      error: message.toLowerCase().includes('cancel')
        ? 'The administrator restart was cancelled. Enhanced Hardware Sensors remains disabled.'
        : `Unable to restart with administrator privileges: ${message}`
    };
  }
});

ipcMain.handle('app:get-runtime-stats', () => {
  const windows = BrowserWindow.getAllWindows();
  return summarizeElectronAppMetrics(app.getAppMetrics(), {
    windowCount: windows.length,
    visibleWindowCount: windows.filter((window) => !window.isDestroyed() && window.isVisible()).length,
    uptimeSeconds: process.uptime()
  });
});

ipcMain.handle('diagnostics:list', () => listPublicDiagnostics());

ipcMain.handle('diagnostics:run', async (event, diagnosticId) => {
  const definition = getDiagnosticDefinition(diagnosticId);
  if (!definition) return { ok: false, error: 'Unknown diagnostic selection.' };
  if (activeDiagnosticRun) {
    return { ok: false, error: `A diagnostic is already running: ${activeDiagnosticRun.label}` };
  }
  if (definition.kind === 'system') {
    try {
      return {
        ok: true,
        immediate: true,
        id: definition.id,
        label: definition.label,
        output: await buildSystemDiagnosticReport()
      };
    } catch (error) {
      return { ok: false, error: `Unable to build the system report: ${error.message}` };
    }
  }
  return runDiagnosticScript(event.sender, definition);
});

ipcMain.handle('diagnostics:cancel', (_event, runId) => {
  const state = activeDiagnosticRun;
  if (!state) return { ok: false, error: 'No diagnostic is currently running.' };
  if (runId && String(runId) !== state.runId) return { ok: false, error: 'That diagnostic is no longer active.' };
  state.cancelRequested = true;
  try {
    state.child.kill();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Unable to cancel the diagnostic: ${error.message}` };
  }
});

ipcMain.handle('diagnostics:create-support-bundle', async (_event, rendererPayload = {}) => {
  try {
    const rawPayload = JSON.stringify(rendererPayload || {});
    if (Buffer.byteLength(rawPayload, 'utf8') > 4 * 1024 * 1024) {
      return { ok: false, error: 'The support bundle data exceeds the 4 MB safety limit.' };
    }

    const identity = {
      userName: (() => { try { return os.userInfo().username; } catch (error) { return ''; } })(),
      hostName: (() => { try { return os.hostname(); } catch (error) { return ''; } })()
    };
    const generatedAt = new Date();
    const systemReport = sanitizeSupportText(await buildSystemDiagnosticReport(), identity);
    const sanitizedPayload = sanitizeSupportValue(JSON.parse(rawPayload), identity);
    const manifest = {
      formatVersion: 1,
      app: 'SiR System Monitor',
      appVersion: app.getVersion(),
      generatedAt: generatedAt.toISOString(),
      privacy: {
        redacted: ['user name', 'computer name', 'user profile paths', 'IP addresses', 'MAC addresses', 'email addresses', 'hosts', 'tokens', 'passwords', 'credentials', 'custom sensor names'],
        note: 'Review the included text and JSON files before sharing the archive.'
      },
      files: ['manifest.json', 'system-report.txt', 'diagnostics.txt', 'settings.json', 'sensor-catalog.json', 'runtime.json']
    };
    const files = {
      'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
      'system-report.txt': `${systemReport.trim()}\n`,
      'diagnostics.txt': `${String(sanitizedPayload.diagnostics || 'No diagnostic checks were run before the bundle was created.').trim()}\n`,
      'settings.json': `${JSON.stringify(sanitizedPayload.settings || {}, null, 2)}\n`,
      'sensor-catalog.json': `${JSON.stringify(sanitizedPayload.sensorCatalog || {}, null, 2)}\n`,
      'runtime.json': `${JSON.stringify(sanitizedPayload.runtime || {}, null, 2)}\n`
    };
    const archive = createSupportZip(files, generatedAt);
    const stamp = generatedAt.toISOString().replace(/[:.]/g, '-');
    const saveOptions = {
      title: 'Create SiR System Monitor Support Bundle',
      defaultPath: path.join(app.getPath('documents'), `SiR-System-Monitor-Support-${stamp}.zip`),
      buttonLabel: 'Create Bundle',
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    };
    const ownerWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const saveResult = ownerWindow
      ? await dialog.showSaveDialog(ownerWindow, saveOptions)
      : await dialog.showSaveDialog(saveOptions);
    if (saveResult.canceled || !saveResult.filePath) return { ok: false, canceled: true };
    await fs.promises.writeFile(saveResult.filePath, archive);
    return { ok: true, filePath: saveResult.filePath, bytes: archive.length };
  } catch (error) {
    return { ok: false, error: `Unable to create the support bundle: ${error.message}` };
  }
});

ipcMain.handle('app-behavior:get', () => {
  return appBehaviorSettings;
});

ipcMain.handle('app:is-elevated', () => isRunningAsAdministrator());

ipcMain.handle('hardware-access:get-status', () => getHardwareAccessDriverStatus());

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
      if (isMissingLatestYmlError(error) || isMissingLocalUpdateConfigError(error)) {
        const fallback = await checkForAppUpdates();
        const missingLocalConfig = isMissingLocalUpdateConfigError(error);
        return {
          ...fallback,
          usingAutoUpdater: false,
          manualDownloadOnly: true,
          releaseUrl: String(fallback?.releaseUrl || fallbackReleaseUrl || '').trim(),
          warning: missingLocalConfig
            ? 'The installed updater configuration is missing. Release checking succeeded through GitHub; reinstall this build to restore in-app downloads.'
            : 'GitHub release is missing latest.yml, so in-app download is unavailable. Use Open Latest Release.'
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
    if (isMissingLocalUpdateConfigError(error)) {
      return {
        ok: false,
        code: 'missing-app-update-config',
        error: 'The installed updater configuration is missing. Reinstall this build to restore in-app downloads.'
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
