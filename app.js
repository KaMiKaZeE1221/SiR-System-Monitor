const SensorReader = require('./sensorReader');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { shell, ipcRenderer } = require('electron');

const APP_PACKAGE = (() => {
  try {
    return require('./package.json');
  } catch (error) {
    return {};
  }
})();

function parseGithubRepoFromRepositoryField(repositoryField) {
  const raw = typeof repositoryField === 'string'
    ? repositoryField
    : typeof repositoryField?.url === 'string'
      ? repositoryField.url
      : '';

  const text = String(raw || '').trim();
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

const APP_VERSION = String(APP_PACKAGE?.version || '').trim();
const DEFAULT_LATEST_RELEASE_URL = (() => {
  const repo = parseGithubRepoFromRepositoryField(APP_PACKAGE?.repository);
  if (!repo) return '';
  return `https://github.com/${repo.owner}/${repo.repo}/releases/latest`;
})();

let sensorReader = new SensorReader();
let updateInterval = 1000;
let updateTimer;
let sensorSelection = {};
let sensorCategorySelection = {};
let sensorCategoryCollapse = {};
let sensorOrderByGroup = {};
let sensorCatalogSignature = '';
let updateInProgress = false;
let rerunUpdateRequested = false;
let updateLoopActive = false;
let nextUpdateDueAt = 0;
let lastSuccessfulSensorReadAt = 0;
const SENSOR_READ_STALE_HOLD_MS = 8000;
const renderGroupSignatureCache = {};
const SENSOR_SELECTION_KEY = 'sensorSelection';
const SENSOR_CATEGORY_SELECTION_KEY = 'sensorCategorySelection';
const SENSOR_CATEGORY_COLLAPSE_KEY = 'sensorCategoryCollapse';
const SENSOR_ORDER_KEY = 'sensorOrderByGroup';
const FONT_SIZE_KEY = 'fontSize';
const FONT_FAMILY_KEY = 'fontFamily';
const VALUE_FONT_MONOSPACE_KEY = 'valueFontMonospace';
const FONT_BOLD_KEY = 'fontBold';
const TEMPERATURE_UNIT_KEY = 'temperatureUnit';
const PROVIDER_SELECTION_KEY = 'providerSelection';
const SENSOR_CUSTOM_NAMES_KEY = 'sensorCustomNames';
const SETTINGS_ACCORDION_STATE_KEY = 'settingsAccordionState';
const WINDOW_ORDER_KEY = 'windowOrder';
const WINDOW_SIZE_KEY = 'windowSize';
const MONITORING_MODE_KEY = 'monitoringMode';
const SUMMARY_MODE_KEY = 'summaryMode';
const VIEW_MODE_KEY = 'viewMode';
const GRAPH_EXPANDED_KEY = 'graphExpandedSensors';
const WEB_MONITOR_SETTINGS_KEY = 'webMonitorSettings';
const SETUP_GUIDE_SUPPRESS_KEY = 'setupGuideSuppress';
const APP_BEHAVIOR_SETTINGS_KEY = 'appBehaviorSettings';
const SIDEBAR_WIDTH_KEY = 'sidebarWidth';
const SENSOR_GROUP_ORDER = ['cpu', 'gpu', 'ram', 'psu', 'fans', 'network', 'drives', 'other'];
const SENSOR_GROUP_LABELS = {
  cpu: 'CPU',
  gpu: 'GPU',
  ram: 'RAM',
  psu: 'PSU',
  fans: 'Fans',
  network: 'Network',
  drives: 'Drives',
  other: 'Other'
};
const SENSOR_GROUP_ICONS = {
  cpu: 'bi-cpu-fill',
  gpu: 'bi-gpu-card',
  ram: 'bi-memory',
  psu: 'bi-plug-fill',
  fans: 'bi-fan',
  network: 'bi-globe',
  drives: 'bi-device-hdd-fill',
  other: 'bi-tools'
};
const VIEW_MODE_SEQUENCE = ['standard', 'compact', 'wide', 'glass', 'terminal'];
const VIEW_MODE_LABELS = {
  standard: 'Classic',
  compact: 'Neon',
  wide: 'Minimal',
  glass: 'Glass',
  terminal: 'Terminal'
};
const VIEW_MODE_GROUP_ICONS = {
  standard: {
    cpu: 'bi-cpu-fill',
    gpu: 'bi-gpu-card',
    ram: 'bi-memory',
    psu: 'bi-plug-fill',
    fans: 'bi-fan',
    network: 'bi-globe',
    drives: 'bi-device-hdd-fill',
    other: 'bi-tools'
  },
  compact: {
    cpu: 'bi-speedometer2',
    gpu: 'bi-badge-8k',
    ram: 'bi-diagram-3',
    psu: 'bi-lightning-charge',
    fans: 'bi-wind',
    network: 'bi-wifi',
    drives: 'bi-hdd-stack',
    other: 'bi-stars'
  },
  wide: {
    cpu: 'bi-cpu',
    gpu: 'bi-gpu-card',
    ram: 'bi-memory',
    psu: 'bi-plug',
    fans: 'bi-fan',
    network: 'bi-ethernet',
    drives: 'bi-device-hdd',
    other: 'bi-sliders'
  },
  glass: {
    cpu: 'bi-cpu-fill',
    gpu: 'bi-badge-hd',
    ram: 'bi-memory',
    psu: 'bi-lightning-charge-fill',
    fans: 'bi-fan',
    network: 'bi-broadcast-pin',
    drives: 'bi-hdd-network',
    other: 'bi-gem'
  },
  terminal: {
    cpu: 'bi-terminal-fill',
    gpu: 'bi-pc-display-horizontal',
    ram: 'bi-diagram-2-fill',
    psu: 'bi-battery-half',
    fans: 'bi-arrow-repeat',
    network: 'bi-router-fill',
    drives: 'bi-device-ssd-fill',
    other: 'bi-braces-asterisk'
  }
};
const GROUP_CARD_IDS = {
  cpu: 'cpuGroup',
  gpu: 'gpuGroup',
  ram: 'ramGroup',
  psu: 'psuGroup',
  fans: 'fansGroup',
  network: 'networkGroup',
  drives: 'drivesGroup',
  other: 'externalGroup'
};
const CARD_GROUP_IDS = Object.fromEntries(Object.entries(GROUP_CARD_IDS).map(([group, cardId]) => [cardId, group]));
const SENSOR_HISTORY_WINDOW_MS = 60000;
const SENSOR_HISTORY_MAX_POINTS = 600;
const sensorHistory = {};
const sensorSessionStats = {};
let expandedGraphSensors = new Set();
let summaryModeEnabled = (function() {
  try {
    const raw = localStorage.getItem(SUMMARY_MODE_KEY);
    if (raw === null) return false; // If not set, default to false
    return JSON.parse(raw) === true;
  } catch (e) {
    return false;
  }
})();
// Low Overhead mode removed
let latestSelectedGroupedSensors = createEmptyGroupedBuckets();
let liveSensorCatalogSignature = '';
let cachedOrderedSensorCatalog = createEmptyGroupedBuckets();
let sensorCustomNames = {};
let pendingVisibilityRefresh = false;
let lastUiRenderAt = 0;
let forceNextUiRender = true;
const UI_RENDER_MIN_INTERVAL_MS = 1000;
let webMonitorServer = null;
let webMonitorSockets = new Set();
let lastWebSummaryActivityAt = 0;
const WEB_SUMMARY_ACTIVITY_TTL_MS = 4000;
let webMonitorRuntime = {
  running: false,
  error: '',
  urls: [],
  host: '127.0.0.1',
  port: 17381
};

function clampRefreshInterval(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1000;
  return Math.max(1000, Math.min(5000, Math.round(numeric)));
}
let latestWebPayload = {
  app: 'SiR System Monitor',
  version: APP_VERSION,
  updatedAt: Date.now(),
  mode: 'wmi',
  external: 'N/A',
  groups: {},
  settings: {}
};

const DEFAULT_WEB_MONITOR_SETTINGS = {
  enabled: false,
  autoStart: true,
  host: '127.0.0.1',
  port: 17381
};

const DEFAULT_APP_BEHAVIOR_SETTINGS = {
  launchAtStartup: false,
  startMinimized: false,
  minimizeToTray: false,
  closeToTray: false,
  enableDiscordRichPresence: true
};

const FONT_FAMILY_MAP = {
  segoe: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
  arial: "Arial, Helvetica, sans-serif",
  verdana: "Verdana, Geneva, sans-serif",
  tahoma: "Tahoma, 'Segoe UI', sans-serif",
  georgia: "Georgia, 'Times New Roman', serif",
  calibri: "Calibri, Candara, 'Segoe UI', sans-serif",
  trebuchet: "'Trebuchet MS', 'Segoe UI', sans-serif",
  cambria: "Cambria, Georgia, serif",
  garamond: "Garamond, 'Times New Roman', serif",
  consolas: "Consolas, 'Courier New', monospace",
  monospace: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
};
const VALUE_MONOSPACE_FONT_STACK = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

function loadExpandedGraphSensors() {
  try {
    const raw = localStorage.getItem(GRAPH_EXPANDED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch (e) {
    return new Set();
  }
}

function saveExpandedGraphSensors() {
  localStorage.setItem(GRAPH_EXPANDED_KEY, JSON.stringify(Array.from(expandedGraphSensors)));
}

function loadWebMonitorSettings() {
  try {
    const raw = localStorage.getItem(WEB_MONITOR_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      enabled: parsed.enabled === true,
      autoStart: parsed.autoStart !== false,
      host: typeof parsed.host === 'string' && parsed.host.trim() ? parsed.host.trim() : DEFAULT_WEB_MONITOR_SETTINGS.host,
      port: Number.isFinite(Number(parsed.port)) ? Number(parsed.port) : DEFAULT_WEB_MONITOR_SETTINGS.port
    };
  } catch (e) {
    return { ...DEFAULT_WEB_MONITOR_SETTINGS };
  }
}

function normalizeWebMonitorSettings(input) {
  const source = input || DEFAULT_WEB_MONITOR_SETTINGS;
  const normalizedPort = Math.max(1024, Math.min(65535, Math.round(Number(source.port) || DEFAULT_WEB_MONITOR_SETTINGS.port)));
  const normalizedHost = String(source.host || DEFAULT_WEB_MONITOR_SETTINGS.host).trim() || DEFAULT_WEB_MONITOR_SETTINGS.host;

  return {
    enabled: !!source.enabled,
    autoStart: source.autoStart !== false,
    host: normalizedHost,
    port: normalizedPort
  };
}

function saveWebMonitorSettings(settings) {
  const normalized = normalizeWebMonitorSettings(settings);
  localStorage.setItem(WEB_MONITOR_SETTINGS_KEY, JSON.stringify(normalized));
}

function normalizeAppBehaviorSettings(input) {
  return {
    launchAtStartup: !!input?.launchAtStartup,
    startMinimized: !!input?.startMinimized,
    minimizeToTray: !!input?.minimizeToTray,
    closeToTray: !!input?.closeToTray,
    enableDiscordRichPresence: typeof input?.enableDiscordRichPresence === 'boolean'
      ? input.enableDiscordRichPresence
      : true
  };
}

function loadAppBehaviorSettingsLocal() {
  try {
    const raw = localStorage.getItem(APP_BEHAVIOR_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : DEFAULT_APP_BEHAVIOR_SETTINGS;
    return normalizeAppBehaviorSettings(parsed);
  } catch (error) {
    return { ...DEFAULT_APP_BEHAVIOR_SETTINGS };
  }
}

function saveAppBehaviorSettingsLocal(settings) {
  const normalized = normalizeAppBehaviorSettings(settings);
  localStorage.setItem(APP_BEHAVIOR_SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}

async function getAppBehaviorSettings() {
  if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') {
    return loadAppBehaviorSettingsLocal();
  }

  try {
    const settings = await ipcRenderer.invoke('app-behavior:get');
    return saveAppBehaviorSettingsLocal(settings || DEFAULT_APP_BEHAVIOR_SETTINGS);
  } catch (error) {
    console.error('Failed to read app behavior settings from main process:', error);
    return loadAppBehaviorSettingsLocal();
  }
}

async function setAppBehaviorSettings(nextSettings) {
  const normalized = normalizeAppBehaviorSettings(nextSettings);

  if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') {
    return saveAppBehaviorSettingsLocal(normalized);
  }

  try {
    const saved = await ipcRenderer.invoke('app-behavior:set', normalized);
    return saveAppBehaviorSettingsLocal(saved || normalized);
  } catch (error) {
    console.error('Failed to save app behavior settings to main process:', error);
    return saveAppBehaviorSettingsLocal(normalized);
  }
}

function getWebMonitorUrls(host, port) {
  const normalizedHost = String(host || '').trim();
  const urls = [];

  if (!normalizedHost || normalizedHost === '127.0.0.1' || normalizedHost === 'localhost') {
    urls.push(`http://localhost:${port}`);
    return urls;
  }

  if (normalizedHost === '0.0.0.0' || normalizedHost === '::') {
    urls.push(`http://localhost:${port}`);
    const nets = os.networkInterfaces();
    Object.values(nets).forEach((entries) => {
      (entries || []).forEach((entry) => {
        if (entry && entry.family === 'IPv4' && !entry.internal && entry.address) {
          urls.push(`http://${entry.address}:${port}`);
        }
      });
    });
    return Array.from(new Set(urls));
  }

  return [`http://${normalizedHost}:${port}`];
}

function buildWebMonitorHtml() {
  let iconSrc = 'SiR_SM_Circle.ico';
  try {
    const icoPath = path.join(__dirname, 'SiR_SM_Circle.ico');
    if (fs.existsSync(icoPath)) {
      const buf = fs.readFileSync(icoPath);
      iconSrc = `data:image/x-icon;base64,${buf.toString('base64')}`;
    }
  } catch (e) {
    // fallback to relative path
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>SiR Monitor Web View</title>
  <link rel="icon" type="image/x-icon" href="${iconSrc}" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" />
  <style>
    :root {
      color-scheme: dark;
      --font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      --value-font-family: var(--font-family);
      --font-scale: 1;
      --font-weight-regular: 500;
      --font-weight-bold: 700;
      --bg-primary: #1a1a1a;
      --bg-secondary: #2d2d2d;
      --bg-tertiary: #3a3a3a;
      --text-primary: #e0e0e0;
      --text-secondary: #b0b0b0;
      --sensor-label-color: #b0b0b0;
      --sensor-value-color: #4d9fff;
      --icon-color: #4d9fff;
      --graph-color: #4d9fff;
      --block-header-color: #0066ff;
      --border-color: #444;
      --accent: #0066ff;
      --accent-light: #4d9fff;
    }
    body { margin: 0; font-family: var(--font-family); background: var(--bg-primary); color: var(--text-primary); }
    .wrap { max-width: 1400px; margin: 0 auto; padding: 10px; }
    .header { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 14px; }
    .header-right { display: inline-flex; align-items: center; gap: 8px; }
    .title { font-size: calc(22px * var(--font-scale)); font-weight: var(--font-weight-bold); color: var(--text-primary); }
    .meta { color: var(--text-secondary); font-size: calc(13px * var(--font-scale)); }
    .summary-toggle { border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); border-radius: 7px; padding: 6px 10px; cursor: pointer; font-size: calc(12px * var(--font-scale)); font-weight: var(--font-weight-bold); }
    .summary-toggle:hover { background: var(--border-color); color: var(--text-primary); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 10px; }
    .card { border: 1px solid var(--border-color); border-radius: 10px; background: var(--bg-secondary); padding: 10px; overflow: hidden; display: flex; flex-direction: column; }
    .card h3 { margin: 0 0 10px; font-size: calc(13px * var(--font-scale)); letter-spacing: .08em; color: var(--block-header-color); text-transform: uppercase; font-weight: var(--font-weight-bold); display: flex; align-items: center; gap: 8px; }
    .group-icon { color: var(--icon-color); font-size: calc(14px * var(--font-scale)); line-height: 1; }
    .rows { overflow-y: auto; min-height: 0; flex: 1 1 auto; scrollbar-gutter: stable both-edges; padding-bottom: 12px; scroll-padding-bottom: 12px; }
    .row { display: block; border-bottom: 1px solid var(--border-color); padding: 6px 0; font-size: calc(13px * var(--font-scale)); }
    .row:last-child { border-bottom: none; }
    .row-main { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
    .label { color: var(--sensor-label-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--font-weight-regular); }
    .value { color: var(--sensor-value-color); font-family: var(--value-font-family); white-space: normal; overflow-wrap: anywhere; word-break: break-word; text-align: right; max-width: 58%; font-weight: var(--font-weight-bold); }
    .empty { color: var(--text-secondary); font-size: calc(13px * var(--font-scale)); }
    .error { color: #ff8f8f; }
    .graph { width: 100%; height: 58px; margin-top: 6px; display: block; }
    .graph-line { fill: none; stroke: var(--graph-color); stroke-width: 2; vector-effect: non-scaling-stroke; }
    .graph-meta { margin-top: 3px; display: flex; justify-content: space-between; gap: 6px; color: var(--text-secondary); font-size: calc(10px * var(--font-scale)); }
    body.summary-mode .wrap { max-width: 1900px; }
    body.summary-mode .grid { grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 14px; }
    body.summary-mode .value { display: none; }
    body.summary-mode .row { display: grid; grid-template-columns: minmax(130px, 38%) 1fr; align-items: center; gap: 10px; }
    body.summary-mode .row-main { justify-content: flex-start; min-width: 0; }
    body.summary-mode .label { white-space: normal; overflow: visible; text-overflow: clip; line-height: 1.25; }
    body.summary-mode .summary-holder { margin-left: 0; min-width: 0; }
    body.summary-mode .summary-line { margin-top: 0; white-space: normal; flex-wrap: wrap; gap: 6px; }
    .summary-line { margin-top: 5px; display: flex; align-items: center; justify-content: flex-end; gap: 10px; font-size: calc(11px * var(--font-scale)); color: var(--text-secondary); flex-wrap: wrap; white-space: normal; overflow: visible; text-overflow: unset; }
    .summary-part { display: inline-flex; align-items: baseline; justify-content: flex-end; gap: 4px; min-width: 0; }
    .summary-label { text-transform: uppercase; font-size: calc(10px * var(--font-scale)); letter-spacing: .4px; color: var(--text-secondary); }
    .summary-value { color: var(--sensor-value-color); font-family: var(--value-font-family); font-weight: var(--font-weight-bold); min-width: 0; text-align: right; font-variant-numeric: tabular-nums; }
    .summary-sep { opacity: .65; }
    body.view-compact .wrap { max-width: 1280px; }
    body.view-compact .grid { grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }
    body.view-compact .card {
      padding: 11px;
      border-radius: 18px;
      border-color: color-mix(in srgb, var(--accent-light) 40%, var(--border-color));
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-light) 25%, transparent), 0 10px 24px color-mix(in srgb, var(--accent) 18%, transparent);
      background: linear-gradient(180deg, color-mix(in srgb, var(--bg-secondary) 90%, var(--accent) 10%), var(--bg-secondary));
    }
    body.view-compact .row { padding: 6px 0; }
    body.view-wide .wrap { max-width: 1800px; }
    body.view-wide .grid { grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 16px; }
    body.view-wide .card {
      padding: 14px;
      border-radius: 2px;
      border-width: 2px;
      box-shadow: none;
      background: color-mix(in srgb, var(--bg-secondary) 88%, var(--bg-primary) 12%);
    }
    body.view-wide .card h3 { letter-spacing: 0.12em; }
    body.view-glass .wrap { max-width: 1650px; }
    body.view-glass .grid { grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 14px; }
    body.view-glass .card {
      border-radius: 22px;
      border-color: color-mix(in srgb, var(--text-primary) 25%, transparent);
      background: color-mix(in srgb, var(--bg-secondary) 72%, transparent);
      backdrop-filter: blur(8px);
      box-shadow: 0 12px 30px color-mix(in srgb, var(--bg-primary) 65%, transparent);
    }
    body.view-glass .row { border-bottom-color: color-mix(in srgb, var(--text-secondary) 35%, transparent); }
    body.view-terminal .wrap { max-width: 1500px; }
    body.view-terminal .grid { grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 10px; }
    body.view-terminal .card {
      border-radius: 0;
      border-width: 1px;
      border-color: color-mix(in srgb, var(--accent-light) 55%, var(--border-color));
      box-shadow: none;
      background: color-mix(in srgb, var(--bg-primary) 90%, var(--bg-secondary) 10%);
    }
    body.view-terminal .card h3 {
      letter-spacing: 0.16em;
      font-size: calc(12px * var(--font-scale));
    }
    body.view-terminal .row { border-bottom-style: dashed; }
    body.summary-mode.view-compact .grid { grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); }
    body.summary-mode.view-wide .grid { grid-template-columns: repeat(auto-fit, minmax(500px, 1fr)); }
    body.summary-mode.view-glass .grid { grid-template-columns: repeat(auto-fit, minmax(440px, 1fr)); }
    body.summary-mode.view-terminal .grid { grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div style="display: flex; align-items: center; gap: 12px;">
        <img src="${iconSrc}" alt="SiR System Monitor" style="width: 38px; height: 38px; border-radius: 50%; box-shadow: 0 1px 4px #0002;" />
        <div class="title">SiR System Monitor</div>
        <div id="meta" class="meta">Waiting for data...</div>
      </div>
      <div class="header-right">
        <button id="summaryModeToggle" class="summary-toggle" type="button">Summary Mode</button>
      </div>
    </div>
    <div id="grid" class="grid"></div>
  </div>

  <script>
    const groupOrder = ['cpu', 'gpu', 'ram', 'psu', 'fans', 'network', 'drives', 'other'];
    const groupLabels = { cpu: 'CPU', gpu: 'GPU', ram: 'RAM', psu: 'PSU', fans: 'Fans', network: 'Network', drives: 'Drives', other: 'Other' };
    const groupIconsByMode = {
      standard: { cpu: 'bi-cpu-fill', gpu: 'bi-gpu-card', ram: 'bi-memory', psu: 'bi-plug-fill', fans: 'bi-fan', network: 'bi-globe', drives: 'bi-device-hdd-fill', other: 'bi-tools' },
      compact: { cpu: 'bi-speedometer2', gpu: 'bi-badge-8k', ram: 'bi-diagram-3', psu: 'bi-lightning-charge', fans: 'bi-wind', network: 'bi-wifi', drives: 'bi-hdd-stack', other: 'bi-stars' },
      wide: { cpu: 'bi-cpu', gpu: 'bi-gpu-card', ram: 'bi-memory', psu: 'bi-plug', fans: 'bi-fan', network: 'bi-ethernet', drives: 'bi-device-hdd', other: 'bi-sliders' },
      glass: { cpu: 'bi-cpu-fill', gpu: 'bi-badge-hd', ram: 'bi-memory', psu: 'bi-lightning-charge-fill', fans: 'bi-fan', network: 'bi-broadcast-pin', drives: 'bi-hdd-network', other: 'bi-gem' },
      terminal: { cpu: 'bi-terminal-fill', gpu: 'bi-pc-display-horizontal', ram: 'bi-diagram-2-fill', psu: 'bi-battery-half', fans: 'bi-arrow-repeat', network: 'bi-router-fill', drives: 'bi-device-ssd-fill', other: 'bi-braces-asterisk' }
    };
    const fontScaleMap = { small: 0.92, medium: 1, large: 1.28, xlarge: 1.38, xxlarge: 1.5 };
    const fontFamilyMap = {
      segoe: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
      arial: 'Arial, Helvetica, sans-serif',
      verdana: 'Verdana, Geneva, sans-serif',
      tahoma: "Tahoma, 'Segoe UI', sans-serif",
      georgia: "Georgia, 'Times New Roman', serif",
      calibri: "Calibri, Candara, 'Segoe UI', sans-serif",
      trebuchet: "'Trebuchet MS', 'Segoe UI', sans-serif",
      cambria: 'Cambria, Georgia, serif',
      garamond: "Garamond, 'Times New Roman', serif",
      consolas: "Consolas, 'Courier New', monospace",
      monospace: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
    };
    const domState = {
      structureKey: '',
      rowsByKey: new Map(),
      rowScrollByGroup: new Map(),
      summaryMode: false,
      viewMode: 'standard'
    };

    const SUMMARY_MODE_STORAGE_KEY = 'sirWebSummaryMode';

    // Force web-summary mode OFF for browser view and ensure desktop summary default is unset
    try {
      localStorage.removeItem(SUMMARY_MODE_STORAGE_KEY);
    } catch (e) {}
    try {
      // Clear desktop summary key only if not explicitly set (helps new-user default)
      // Do not force-clear if users have an explicit preference stored as 'true' or 'false'.
      const existing = localStorage.getItem(SUMMARY_MODE_KEY);
      if (existing === null) localStorage.removeItem(SUMMARY_MODE_KEY);
    } catch (e) {}

    function normalizeViewMode(mode) {
      const normalized = String(mode || '').trim().toLowerCase();
      if (normalized === 'compact' || normalized === 'wide' || normalized === 'glass' || normalized === 'terminal') return normalized;
      return 'standard';
    }

    function applyViewMode(mode) {
      const nextMode = normalizeViewMode(mode);
      if (domState.viewMode === nextMode) return;
      domState.viewMode = nextMode;
      document.body.classList.remove('view-compact', 'view-wide', 'view-glass', 'view-terminal');
      if (nextMode !== 'standard') {
        document.body.classList.add('view-' + nextMode);
      }
    }

    function resolveGroupIconClass(group) {
      const modeIcons = groupIconsByMode[domState.viewMode] || groupIconsByMode.standard;
      return modeIcons[group] || groupIconsByMode.standard[group] || 'bi-circle-fill';
    }

    function escapeHtml(text) {
      return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function makeSensorKey(group, sensorId) {
      return group + '::' + sensorId;
    }

    function computeStructureKey(groups, orderedGroups, layout) {
      return orderedGroups
        .map((group) => {
          const sensors = Array.isArray(groups[group]) ? groups[group] : [];
          const rowKey = sensors.map((sensor) => String(sensor.id) + ':' + (sensor.expanded ? '1' : '0')).join(',');
          const groupLayout = layout[group] || {};
          return group + '#h' + (groupLayout.height || 360) + '#s' + (groupLayout.span || 1) + '#' + rowKey + '#summary:' + (domState.summaryMode ? '1' : '0') + '#view:' + domState.viewMode;
        })
        .join('|');
    }

    function formatSummaryMetric(value, units, sensorName) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return '--';
      const unitText = String(units || '').trim();
      const nameText = String(sensorName || '').toLowerCase();
      const isMemoryReading = nameText.includes('memory') || nameText.includes('vram') || nameText.includes('dedicated') || nameText.includes('dynamic');
      const isNetworkTotal =
        nameText.includes('total download') ||
        nameText.includes('total upload') ||
        nameText.includes('total dl') ||
        nameText.includes('total up');

      let displayValue = numeric;
      let displayUnits = unitText;

      if (isMemoryReading) {
        const lowerUnits = unitText.toLowerCase();
        let memoryMb = null;
        if (lowerUnits === 'kb') {
          memoryMb = numeric / 1024;
        } else if (lowerUnits === 'mb') {
          memoryMb = numeric;
        } else if (lowerUnits === 'gb') {
          memoryMb = Math.abs(numeric) >= 1024 ? numeric : (numeric * 1024);
        } else if (lowerUnits === 'tb') {
          memoryMb = numeric * 1024 * 1024;
        }

        if (Number.isFinite(memoryMb)) {
          if (Math.abs(memoryMb) < 1024) {
            displayValue = memoryMb;
            displayUnits = 'MB';
          } else {
            displayValue = memoryMb / 1024;
            displayUnits = 'GB';
          }
        }
      }

      if (isNetworkTotal) {
        const lowerUnits = displayUnits.toLowerCase();
        if (lowerUnits === 'mb' && Math.abs(displayValue) >= 1024) {
          displayValue = displayValue / 1024;
          displayUnits = 'GB';
        }
      }

      const u = displayUnits.toLowerCase();
      let decimals = 2;
      if (!displayUnits) {
        decimals = Math.abs(numeric) >= 100 ? 0 : 2;
      } else if (u === 'rpm' || u === 'fps' || u === '%' || u === 'mhz' || u === 'khz' || u === 'hz') {
        decimals = 0;
      } else if (u === 'ms') {
        decimals = 2;
      } else if (u === 'gb' || u === 'mb' || u === 'kb' || u === 'tb' || u.includes('/s')) {
        decimals = 2;
      }
      return displayValue.toFixed(decimals) + (displayUnits ? (' ' + escapeHtml(displayUnits)) : '');
    }

    function renderSummaryHtml(sensor) {
      const summary = sensor && sensor.summary;
      if (!summary || !Number.isFinite(Number(summary.count)) || Number(summary.count) <= 0) {
        const sensorName = String((sensor && sensor.name) || '').toLowerCase();
        const isStaticSummaryValue =
          sensorName.includes('lan ip') ||
          sensorName.includes('wan ip') ||
          sensorName.includes('memory timing');
        const numericValue = Number(sensor && sensor.value);
        const hasNumericValue = Number.isFinite(numericValue);
        if (isStaticSummaryValue || !hasNumericValue) {
          const staticText = String((sensor && sensor.formatted) || '--').trim() || '--';
          return '<div class="summary-line"><span class="summary-part"><span class="summary-label">Value</span><span class="summary-value">' + escapeHtml(staticText) + '</span></span></div>';
        }
        return '<div class="summary-line">Collecting summary...</div>';
      }

      const units = sensor.units || '';
      const minText = formatSummaryMetric(summary.min, units, sensor.name);
      const maxText = formatSummaryMetric(summary.max, units, sensor.name);

      return '<div class="summary-line">' +
        '<span class="summary-part"><span class="summary-label">Min</span><span class="summary-value">' + minText + '</span></span>' +
        '<span class="summary-sep">•</span>' +
        '<span class="summary-part"><span class="summary-label">Max</span><span class="summary-value">' + maxText + '</span></span>' +
      '</div>';
    }

    function setSummaryMode(enabled, options) {
      const opts = options || {};
      const persist = opts.persist !== false;
      const requested = !!enabled;
      domState.summaryMode = requested;
      document.body.classList.toggle('summary-mode', domState.summaryMode);
      const button = document.getElementById('summaryModeToggle');
      if (button) {
        button.textContent = domState.summaryMode ? 'Exit Summary Mode' : 'Summary Mode';
      }
      if (persist) {
        try {
          localStorage.setItem(SUMMARY_MODE_STORAGE_KEY, domState.summaryMode ? 'true' : 'false');
        } catch (e) {}
      }
    }

    // Low Overhead feature removed; no-op placeholder removed.

    function buildPath(points, width, height, padding) {
      if (!Array.isArray(points) || points.length < 2) return '';
      const values = points.map((p) => Number(p.value)).filter((v) => Number.isFinite(v));
      if (values.length < 2) return '';

      const min = Math.min.apply(null, values);
      const max = Math.max.apply(null, values);
      const range = (max - min) || 1;
      const innerWidth = Math.max(1, width - (padding * 2));
      const innerHeight = Math.max(1, height - (padding * 2));

      return values
        .map((value, index) => {
          const x = padding + ((index / (values.length - 1)) * innerWidth);
          const y = padding + (((max - value) / range) * innerHeight);
          return (index === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2);
        })
        .join(' ');
    }

    function applySyncedSettings(settings) {
      const root = document.documentElement;
      if (!settings || typeof settings !== 'object') return;

      applyViewMode(settings.viewMode || 'standard');

      const palette = settings.palette || {};
      if (palette.bgPrimary) root.style.setProperty('--bg-primary', palette.bgPrimary);
      if (palette.bgSecondary) root.style.setProperty('--bg-secondary', palette.bgSecondary);
      if (palette.bgTertiary) root.style.setProperty('--bg-tertiary', palette.bgTertiary);
      if (palette.textPrimary) root.style.setProperty('--text-primary', palette.textPrimary);
      if (palette.textSecondary) root.style.setProperty('--text-secondary', palette.textSecondary);
      if (palette.sensorLabel) root.style.setProperty('--sensor-label-color', palette.sensorLabel);
      else if (palette.textSecondary) root.style.setProperty('--sensor-label-color', palette.textSecondary);
      if (palette.sensorValue) root.style.setProperty('--sensor-value-color', palette.sensorValue);
      else if (palette.accentLight) root.style.setProperty('--sensor-value-color', palette.accentLight);
      if (palette.iconColor) root.style.setProperty('--icon-color', palette.iconColor);
      else if (palette.accentLight) root.style.setProperty('--icon-color', palette.accentLight);
      if (palette.graphColor) root.style.setProperty('--graph-color', palette.graphColor);
      else if (palette.accentLight) root.style.setProperty('--graph-color', palette.accentLight);
      if (palette.blockHeaderColor) root.style.setProperty('--block-header-color', palette.blockHeaderColor);
      else if (palette.accent) root.style.setProperty('--block-header-color', palette.accent);
      if (palette.borderColor) root.style.setProperty('--border-color', palette.borderColor);
      if (palette.accent) root.style.setProperty('--accent', palette.accent);
      if (palette.accentLight) root.style.setProperty('--accent-light', palette.accentLight);

      const scale = fontScaleMap[settings.fontSize] || 1;
      root.style.setProperty('--font-scale', String(scale));
      const fontFamily = fontFamilyMap[settings.fontFamily] || fontFamilyMap.segoe;
      root.style.setProperty('--font-family', fontFamily);
      root.style.setProperty('--value-font-family', settings.valueMonospace ? fontFamilyMap.monospace : fontFamily);
      if (settings.fontBold) {
        root.style.setProperty('--font-weight-regular', '600');
        root.style.setProperty('--font-weight-bold', '750');
      } else {
        root.style.setProperty('--font-weight-regular', '500');
        root.style.setProperty('--font-weight-bold', '700');
      }
    }

    function toLocalTime(ts) {
      if (!ts) return '--';
      return new Date(ts).toLocaleTimeString();
    }

    function renderGraphHtml(sensor) {
      if (!sensor || !sensor.expanded || !Array.isArray(sensor.history) || sensor.history.length < 2) return '';

      const width = 280;
      const height = 58;
      const padding = 5;
      const path = buildPath(sensor.history, width, height, padding);
      const numeric = sensor.history.map((p) => Number(p.value)).filter((v) => Number.isFinite(v));
      if (!path || !numeric.length) return '';

      const min = Math.min.apply(null, numeric).toFixed(1);
      const max = Math.max.apply(null, numeric).toFixed(1);
      const now = numeric[numeric.length - 1].toFixed(1);
      const unit = sensor.units ? ' ' + escapeHtml(sensor.units) : '';

      return '<svg class="graph" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none"><path class="graph-line" d="' + path + '"></path></svg>' +
        '<div class="graph-meta"><span>Min ' + min + unit + '</span><span>Now ' + now + unit + '</span><span>Max ' + max + unit + '</span></div>';
    }

    function rebuildGrid(groups, orderedGroups, layout, grid) {
      domState.rowScrollByGroup.clear();
      grid.querySelectorAll('.rows[data-group]').forEach((rowsEl) => {
        domState.rowScrollByGroup.set(rowsEl.dataset.group, rowsEl.scrollTop || 0);
      });

      domState.rowsByKey.clear();
      grid.innerHTML = '';

      orderedGroups.forEach((group) => {
        const sensors = Array.isArray(groups[group]) ? groups[group] : [];
        if (!sensors.length) return;

        const card = document.createElement('section');
        card.className = 'card';
        const groupLayout = layout[group] || {};
        card.style.gridColumn = 'span ' + (groupLayout.span || 1);
        card.style.height = (groupLayout.height || 360) + 'px';

        const title = document.createElement('h3');
        const iconClass = resolveGroupIconClass(group);
        title.innerHTML = '<i class="bi ' + iconClass + ' group-icon" aria-hidden="true"></i><span>' + escapeHtml(groupLabels[group] || group) + '</span>';
        card.appendChild(title);

        const rowsWrap = document.createElement('div');
        rowsWrap.className = 'rows';
        rowsWrap.dataset.group = group;

        sensors.forEach((sensor) => {
          const sensorKey = makeSensorKey(group, sensor.id);
          const row = document.createElement('div');
          row.className = 'row';
          row.dataset.sensorKey = sensorKey;

          const rowMain = document.createElement('div');
          rowMain.className = 'row-main';

          const label = document.createElement('span');
          label.className = 'label';
          label.textContent = sensor.name || '--';

          const value = document.createElement('span');
          value.className = 'value';
          value.textContent = sensor.formatted || '--';

          rowMain.appendChild(label);
          rowMain.appendChild(value);
          row.appendChild(rowMain);

          const graphHolder = document.createElement('div');
          graphHolder.className = 'graph-holder';
          const summaryHolder = document.createElement('div');
          summaryHolder.className = 'summary-holder';

          if (domState.summaryMode) {
            summaryHolder.innerHTML = renderSummaryHtml(sensor);
            graphHolder.innerHTML = '';
          } else {
            graphHolder.innerHTML = renderGraphHtml(sensor);
            summaryHolder.innerHTML = '';
          }

          row.appendChild(summaryHolder);
          row.appendChild(graphHolder);

          rowsWrap.appendChild(row);
          domState.rowsByKey.set(sensorKey, { valueEl: value, graphEl: graphHolder, summaryEl: summaryHolder, labelEl: label });
        });

        card.appendChild(rowsWrap);
        grid.appendChild(card);

        const previousScroll = domState.rowScrollByGroup.get(group) || 0;
        rowsWrap.scrollTop = previousScroll;
      });

      if (!grid.children.length) {
        grid.innerHTML = '<div class="empty">No selected sensors available. Choose MSI mode and enable sensors in the desktop app.</div>';
      }
    }

    function updateGridValues(groups, orderedGroups) {
      orderedGroups.forEach((group) => {
        const sensors = Array.isArray(groups[group]) ? groups[group] : [];
        sensors.forEach((sensor) => {
          const sensorKey = makeSensorKey(group, sensor.id);
          const refs = domState.rowsByKey.get(sensorKey);
          if (!refs) return;

          const nextLabel = sensor.name || '--';
          const nextValue = sensor.formatted || '--';
          if (refs.labelEl.textContent !== nextLabel) refs.labelEl.textContent = nextLabel;
          if (!domState.summaryMode && refs.valueEl.textContent !== nextValue) refs.valueEl.textContent = nextValue;

          if (domState.summaryMode) {
            const summaryHtml = renderSummaryHtml(sensor);
            const existingSummary = refs.summaryEl.dataset.summaryHtml || '';
            if (existingSummary !== summaryHtml) {
              refs.summaryEl.dataset.summaryHtml = summaryHtml;
              refs.summaryEl.innerHTML = summaryHtml;
            }
            if (refs.graphEl.innerHTML) {
              refs.graphEl.innerHTML = '';
              refs.graphEl.dataset.graphHtml = '';
            }
          } else {
            const graphHtml = renderGraphHtml(sensor);
            const existing = refs.graphEl.dataset.graphHtml || '';
            if (existing !== graphHtml) {
              refs.graphEl.dataset.graphHtml = graphHtml;
              refs.graphEl.innerHTML = graphHtml;
            }
            if (refs.summaryEl.innerHTML) {
              refs.summaryEl.innerHTML = '';
              refs.summaryEl.dataset.summaryHtml = '';
            }
          }
        });
      });
    }

    function render(payload) {
      const meta = document.getElementById('meta');
      const grid = document.getElementById('grid');
      if (!payload || typeof payload !== 'object') {
        meta.textContent = 'No payload available';
        grid.innerHTML = '<div class="empty">No data</div>';
        return;
      }

      applySyncedSettings(payload.settings || {});
      const rawMode = String(payload.mode || '').toLowerCase();
      const modeLabel = rawMode === 'msi' ? 'Shared Memory' : (payload.mode || 'N/A');
      const version = String(payload.version || APP_VERSION || 'N/A').trim() || 'N/A';
      meta.textContent = 'Mode: ' + modeLabel + ' | Version: ' + version + ' | Updated: ' + toLocalTime(payload.updatedAt);

      if (!domState.initializedSummaryMode) {
        let initialSummaryMode = false;
        try {
          const stored = localStorage.getItem(SUMMARY_MODE_STORAGE_KEY);
          if (stored === 'true') {
            initialSummaryMode = true;
          } else {
            initialSummaryMode = false;
          }
        } catch (e) {
          initialSummaryMode = false;
        }

        setSummaryMode(initialSummaryMode);
        const summaryToggle = document.getElementById('summaryModeToggle');
        if (summaryToggle) {
          summaryToggle.addEventListener('click', () => {
            setSummaryMode(!domState.summaryMode);
            domState.structureKey = '';
            render(payload);
          });
        }
        domState.initializedSummaryMode = true;
      }

      const groups = payload.groups || {};
      const layout = (payload.settings && payload.settings.groupLayout) ? payload.settings.groupLayout : {};
      const orderedGroups = Array.isArray(payload.settings && payload.settings.groupOrder) ? payload.settings.groupOrder : groupOrder;

      const structureKey = computeStructureKey(groups, orderedGroups, layout);
      if (structureKey !== domState.structureKey) {
        domState.structureKey = structureKey;
        rebuildGrid(groups, orderedGroups, layout, grid);
      }

      updateGridValues(groups, orderedGroups);
    }

    let loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      try {
        const summaryParam = domState.summaryMode ? '1' : '0';
        const response = await fetch('/api/monitor?summary=' + summaryParam, { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const payload = await response.json();
        render(payload);
      } catch (err) {
        let msg = '' + (err && (err.message || err.toString()) || 'Unknown error');
        if (/networkerror|failed to fetch|network request failed|typeerror/i.test(msg)) {
          msg = 'Disconnected from host';
        } else if (!/^web monitor error:/i.test(msg)) {
          msg = 'Web monitor error: ' + msg;
        }
        document.getElementById('meta').innerHTML = '<span class="error">' + msg + '</span>';
      } finally {
        loading = false;
      }
    }

    load();
    setInterval(load, 1000);
  </script>
</body>
</html>`;
}

function isWebSummaryModeActive() {
  if (!webMonitorRuntime.running) return false;
  return (Date.now() - lastWebSummaryActivityAt) <= WEB_SUMMARY_ACTIVITY_TTL_MS;
}

function shouldCollectSummaryStats() {
  return true;
}

function publishWebMonitorPayload(mode, externalText) {
  const sizeMap = loadWindowSizes();
  const windowOrder = loadWindowOrder();
  const orderedGroups = windowOrder
    .map((cardId) => CARD_GROUP_IDS[cardId])
    .filter((group) => !!group);
  const missingGroups = SENSOR_GROUP_ORDER.filter((group) => !orderedGroups.includes(group));
  const groupOrder = [...orderedGroups, ...missingGroups];

  const groupLayout = {};
  SENSOR_GROUP_ORDER.forEach((group) => {
    const cardId = GROUP_CARD_IDS[group];
    const saved = sizeMap[cardId];
    const savedHeight = Number(typeof saved === 'object' ? saved.height : saved);
    const savedSpan = Number(typeof saved === 'object' ? saved.span : 1);

    groupLayout[group] = {
      height: Number.isFinite(savedHeight) && savedHeight >= 220 && savedHeight <= 900 ? savedHeight : 360,
      span: Number.isFinite(savedSpan) && savedSpan >= 1 ? savedSpan : 1
    };
  });

  const selectedTheme = (localStorage.getItem('theme') || 'blue').toLowerCase();
  const selectedFontSize = localStorage.getItem(FONT_SIZE_KEY) || 'medium';
  const selectedFontFamily = localStorage.getItem(FONT_FAMILY_KEY) || 'segoe';
  const selectedValueMonospace = localStorage.getItem(VALUE_FONT_MONOSPACE_KEY) === 'true';
  const selectedBold = localStorage.getItem(FONT_BOLD_KEY) === 'true';
  const selectedTempUnit = normalizeTemperatureUnit(localStorage.getItem(TEMPERATURE_UNIT_KEY));
  const computed = getComputedStyle(document.body);
  const palette = {
    bgPrimary: computed.getPropertyValue('--bg-primary').trim() || '#1a1a1a',
    bgSecondary: computed.getPropertyValue('--bg-secondary').trim() || '#2d2d2d',
    bgTertiary: computed.getPropertyValue('--bg-tertiary').trim() || '#3a3a3a',
    textPrimary: computed.getPropertyValue('--text-primary').trim() || '#e0e0e0',
    textSecondary: computed.getPropertyValue('--text-secondary').trim() || '#b0b0b0',
    sensorLabel: computed.getPropertyValue('--sensor-label-color').trim() || computed.getPropertyValue('--text-secondary').trim() || '#b0b0b0',
    sensorValue: computed.getPropertyValue('--sensor-value-color').trim() || computed.getPropertyValue('--accent-light').trim() || '#4d9fff',
    iconColor: computed.getPropertyValue('--icon-color').trim() || computed.getPropertyValue('--accent-light').trim() || '#4d9fff',
    graphColor: computed.getPropertyValue('--graph-color').trim() || computed.getPropertyValue('--accent-light').trim() || '#4d9fff',
    blockHeaderColor: computed.getPropertyValue('--block-header-color').trim() || computed.getPropertyValue('--accent').trim() || '#0066ff',
    borderColor: computed.getPropertyValue('--border-color').trim() || '#444',
    accent: computed.getPropertyValue('--accent').trim() || '#0066ff',
    accentLight: computed.getPropertyValue('--accent-light').trim() || '#4d9fff'
  };

  const groups = {};
  const includeSummary = shouldCollectSummaryStats();
  SENSOR_GROUP_ORDER.forEach((group) => {
    groups[group] = (latestSelectedGroupedSensors[group] || []).map((sensor) => {
      const resolvedUnits = resolveDisplayUnits(sensor) || sensor.units || inferUnitsFromSensor(sensor);
      const numericValue = Number(sensor.value);
      const hasNumericValue = Number.isFinite(numericValue);
      const sensorForFormatting = { ...sensor, units: resolvedUnits };
      const normalizedCurrent = hasNumericValue ? normalizeValueForDisplay(sensorForFormatting, numericValue) : null;
      const history = expandedGraphSensors.has(sensor.id)
        ? (sensorHistory[sensor.id] || []).slice(-120).map((point) => {
          const rawPointValue = Number(point.value);
          if (!Number.isFinite(rawPointValue)) {
            return { ts: point.ts, value: point.value };
          }
          const normalizedPoint = normalizeValueForDisplay(sensorForFormatting, rawPointValue);
          return { ts: point.ts, value: normalizedPoint.value };
        })
        : [];
      return {
        id: sensor.id,
        name: sensor.name,
        value: hasNumericValue && normalizedCurrent ? normalizedCurrent.value : sensor.value,
        units: hasNumericValue && normalizedCurrent ? normalizedCurrent.units : resolvedUnits,
        formatted: formatSensorValue(sensorForFormatting),
        expanded: expandedGraphSensors.has(sensor.id),
        history,
        summary: (includeSummary && hasNumericValue) ? (() => {
          const stats = sensorSessionStats[sensor.id];
          if (!stats || !Number.isFinite(stats.count) || stats.count <= 0) {
            return { min: null, max: null, count: 0 };
          }
          const normalizedMin = normalizeValueForDisplay(sensorForFormatting, stats.min);
          const normalizedMax = normalizeValueForDisplay(sensorForFormatting, stats.max);
          return {
            min: normalizedMin.value,
            max: normalizedMax.value,
            count: stats.count
          };
        })() : null
      };
    });
  });

    latestWebPayload = {
    app: 'SiR System Monitor',
    version: APP_VERSION,
    updatedAt: Date.now(),
    mode,
    external: externalText || 'N/A',
    groups,
    settings: {
      theme: selectedTheme,
      fontSize: selectedFontSize,
      fontFamily: selectedFontFamily,
      valueMonospace: selectedValueMonospace,
      fontBold: selectedBold,
      temperatureUnit: selectedTempUnit,
      summaryMode: summaryModeEnabled,
      viewMode: normalizeViewMode(localStorage.getItem(VIEW_MODE_KEY) || 'standard'),
      groupOrder,
      groupLayout,
      palette
    }
  };
}

    function refreshWebMonitorStatusUi() {
      const statusEl = document.getElementById('webMonitorStatus');
      const urlEl = document.getElementById('webMonitorUrl');
      const openBtn = document.getElementById('webMonitorOpenBtn');
      const liveStatusEl = document.getElementById('liveStatusIndicator');
      const toggleBtn = document.getElementById('webMonitorToggleBtn');
      if (liveStatusEl) {
        liveStatusEl.style.display = webMonitorRuntime.running ? 'flex' : 'none';
      }

      // Update header toggle button
      if (toggleBtn) {
        toggleBtn.classList.remove('disabled', 'enabled', 'running');
        if (webMonitorRuntime.running) {
          toggleBtn.classList.add('enabled', 'running');
          toggleBtn.querySelector('.web-monitor-toggle-text').textContent = `Web: ${webMonitorRuntime.host}:${webMonitorRuntime.port}`;
        } else {
          toggleBtn.classList.add('disabled');
          toggleBtn.querySelector('.web-monitor-toggle-text').textContent = 'Web: Off';
        }
      }

      // Always hide the "Sharing" indicator - the header toggle button shows status instead
      if (liveStatusEl) {
        liveStatusEl.style.display = 'none';
      }

      if (!statusEl || !urlEl || !openBtn) return;


      if (webMonitorRuntime.running) {
        statusEl.textContent = `Running on ${webMonitorRuntime.host}:${webMonitorRuntime.port}`;
        statusEl.classList.remove('web-status-error');
        statusEl.classList.add('web-status-running');
        const primaryUrl = webMonitorRuntime.urls[0] || '';
        urlEl.textContent = primaryUrl;
        urlEl.href = primaryUrl;
        openBtn.disabled = !primaryUrl;
      } else {
        statusEl.textContent = webMonitorRuntime.error ? `Error: ${webMonitorRuntime.error}` : 'Stopped';
        statusEl.classList.remove('web-status-running');
        statusEl.classList.toggle('web-status-error', !!webMonitorRuntime.error);
        urlEl.textContent = '--';
        urlEl.removeAttribute('href');
        openBtn.disabled = true;
      }
    }

function stopWebMonitorServer() {
  return new Promise((resolve) => {
    if (!webMonitorServer) {
      webMonitorRuntime.running = false;
      webMonitorRuntime.error = '';
      webMonitorRuntime.urls = [];
      refreshWebMonitorStatusUi();
      resolve();
      return;
    }

    const activeServer = webMonitorServer;
    webMonitorServer = null;
    const sockets = webMonitorSockets;
    webMonitorSockets = new Set();

    const finalizeStop = () => {
      webMonitorRuntime.running = false;
      webMonitorRuntime.error = '';
      webMonitorRuntime.urls = [];
      refreshWebMonitorStatusUi();
      resolve();
    };

    if (typeof activeServer.closeIdleConnections === 'function') {
      activeServer.closeIdleConnections();
    }

    if (typeof activeServer.closeAllConnections === 'function') {
      activeServer.closeAllConnections();
    }

    sockets.forEach((socket) => {
      try {
        socket.destroy();
      } catch (e) {}
    });

    let resolved = false;
    const safeFinalize = () => {
      if (resolved) return;
      resolved = true;
      finalizeStop();
    };

    activeServer.close(() => {
      safeFinalize();
    });

    setTimeout(() => {
      safeFinalize();
    }, 1200);
  });
}

async function startWebMonitorServer(settingsInput) {
  const settings = normalizeWebMonitorSettings(settingsInput || loadWebMonitorSettings());
  await stopWebMonitorServer();

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url || '/', 'http://localhost');
      if (reqUrl.pathname === '/api/monitor') {
        if (reqUrl.searchParams.get('summary') === '1') {
          lastWebSummaryActivityAt = Date.now();
        }
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate'
        });
        res.end(JSON.stringify(latestWebPayload));
        return;
      }

      if (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store'
        });
        res.end(buildWebMonitorHtml());
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    });

    server.on('error', (err) => {
      webMonitorRuntime.running = false;
      webMonitorRuntime.error = err && err.message ? err.message : 'Unknown server error';
      webMonitorRuntime.urls = [];
      refreshWebMonitorStatusUi();
      resolve(false);
    });

    server.on('connection', (socket) => {
      webMonitorSockets.add(socket);
      socket.on('close', () => {
        webMonitorSockets.delete(socket);
      });
    });

    server.listen(settings.port, settings.host, () => {
      webMonitorServer = server;
      webMonitorRuntime.running = true;
      webMonitorRuntime.error = '';
      webMonitorRuntime.host = settings.host;
      webMonitorRuntime.port = settings.port;
      webMonitorRuntime.urls = getWebMonitorUrls(settings.host, settings.port);
      refreshWebMonitorStatusUi();
      resolve(true);
    });
  });
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function updateSensorHistory(selectedGroupedSensors) {
  const now = Date.now();
  const cutoff = now - SENSOR_HISTORY_WINDOW_MS;
  const trackedSensorIds = new Set();

  const trimHistoryPoints = (points) => {
    if (!Array.isArray(points) || !points.length) return;

    let staleCount = 0;
    while (staleCount < points.length && points[staleCount].ts < cutoff) {
      staleCount += 1;
    }
    if (staleCount > 0) {
      points.splice(0, staleCount);
    }

    if (points.length > SENSOR_HISTORY_MAX_POINTS) {
      points.splice(0, points.length - SENSOR_HISTORY_MAX_POINTS);
    }
  };

  Object.values(selectedGroupedSensors || {}).forEach((list) => {
    (list || []).forEach((sensor) => {
      if (!sensor || !sensor.id) return;
      if (!expandedGraphSensors.has(sensor.id)) return;

      trackedSensorIds.add(sensor.id);

      const value = Number(sensor.value);
      if (!Number.isFinite(value)) return;

      if (!sensorHistory[sensor.id]) sensorHistory[sensor.id] = [];
      const points = sensorHistory[sensor.id];
      points.push({ ts: now, value });
      trimHistoryPoints(points);
    });
  });

  Object.keys(sensorHistory).forEach((sensorId) => {
    if (!trackedSensorIds.has(sensorId)) {
      delete sensorHistory[sensorId];
      return;
    }

    const points = sensorHistory[sensorId];
    if (!Array.isArray(points)) {
      delete sensorHistory[sensorId];
      return;
    }

    trimHistoryPoints(points);
    if (points.length === 0) {
      delete sensorHistory[sensorId];
    }
  });
}

function buildSparklinePath(points, width, height, padding) {
  if (!points || points.length < 2) return '';

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const innerWidth = Math.max(1, width - (padding * 2));
  const innerHeight = Math.max(1, height - (padding * 2));

  return points
    .map((point, index) => {
      const x = padding + ((index / (points.length - 1)) * innerWidth);
      const y = padding + ((max - point.value) / range) * innerHeight;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

function renderSensorGraph(sensor) {
  const points = (sensorHistory[sensor.id] || []).slice(-120);
  if (!points.length) {
    return '<div class="stat-graph-empty">Collecting data...</div>';
  }

  const normalizedPoints = points
    .map((point) => {
      const rawPointValue = Number(point.value);
      if (!Number.isFinite(rawPointValue)) return null;
      return normalizeValueForDisplay(sensor, rawPointValue);
    })
    .filter((point) => point && Number.isFinite(point.value));

  if (!normalizedPoints.length) {
    return '<div class="stat-graph-empty">Collecting data...</div>';
  }

  const width = 280;
  const height = 70;
  const padding = 6;
  const graphPoints = normalizedPoints.map((point) => ({ value: point.value }));
  const path = buildSparklinePath(graphPoints, width, height, padding);
  const values = normalizedPoints.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const latest = values[values.length - 1];
  const units = normalizedPoints[normalizedPoints.length - 1].units || sensor.units || inferUnitsFromSensor(sensor);

  return `
    <div class="stat-graph-wrap">
      <svg class="stat-graph" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="${escapeHtml(sensor.name)} history graph">
        <path class="stat-graph-line" d="${path}"></path>
      </svg>
      <div class="stat-graph-meta">
        <span>Min ${min.toFixed(1)}${units ? ` ${escapeHtml(units)}` : ''}</span>
        <span>Now ${latest.toFixed(1)}${units ? ` ${escapeHtml(units)}` : ''}</span>
        <span>Max ${max.toFixed(1)}${units ? ` ${escapeHtml(units)}` : ''}</span>
      </div>
    </div>
  `;
}

function createEmptyGroupedBuckets() {
  return { cpu: [], gpu: [], ram: [], psu: [], fans: [], network: [], drives: [], other: [] };
}

function loadSensorSelection() {
  try {
    const raw = localStorage.getItem(SENSOR_SELECTION_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveSensorSelection() {
  localStorage.setItem(SENSOR_SELECTION_KEY, JSON.stringify(sensorSelection));
}

function loadSensorCategorySelection() {
  try {
    const raw = localStorage.getItem(SENSOR_CATEGORY_SELECTION_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveSensorCategorySelection() {
  localStorage.setItem(SENSOR_CATEGORY_SELECTION_KEY, JSON.stringify(sensorCategorySelection));
}

function loadSensorCategoryCollapse() {
  try {
    const raw = localStorage.getItem(SENSOR_CATEGORY_COLLAPSE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveSensorCategoryCollapse() {
  localStorage.setItem(SENSOR_CATEGORY_COLLAPSE_KEY, JSON.stringify(sensorCategoryCollapse));
}

function normalizeSensorCustomNames(input) {
  if (!input || typeof input !== 'object') return {};
  const output = {};
  Object.entries(input).forEach(([sensorId, name]) => {
    const key = String(sensorId || '').trim();
    const value = String(name || '').trim();
    if (!key || !value) return;
    output[key] = value.slice(0, 80);
  });
  return output;
}

function loadSensorCustomNames() {
  try {
    const raw = localStorage.getItem(SENSOR_CUSTOM_NAMES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return normalizeSensorCustomNames(parsed);
  } catch (e) {
    return {};
  }
}

function saveSensorCustomNames() {
  localStorage.setItem(SENSOR_CUSTOM_NAMES_KEY, JSON.stringify(normalizeSensorCustomNames(sensorCustomNames)));
}

function loadSensorOrder() {
  try {
    const raw = localStorage.getItem(SENSOR_ORDER_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

function saveSensorOrder() {
  localStorage.setItem(SENSOR_ORDER_KEY, JSON.stringify(sensorOrderByGroup));
}

function ensureSensorOrderDefaults(groupedSensors) {
  let changed = false;

  Object.keys(groupedSensors || {}).forEach((group) => {
    const sensors = Array.isArray(groupedSensors[group]) ? groupedSensors[group] : [];
    const availableIds = sensors.map((sensor) => sensor.id).filter(Boolean);
    const availableSet = new Set(availableIds);

    const existing = Array.isArray(sensorOrderByGroup[group]) ? sensorOrderByGroup[group] : [];
    const filteredExisting = existing.filter((id) => availableSet.has(id));
    const filteredSet = new Set(filteredExisting);
    const missing = availableIds.filter((id) => !filteredSet.has(id));
    const next = [...filteredExisting, ...missing];

    if (JSON.stringify(existing) !== JSON.stringify(next)) {
      sensorOrderByGroup[group] = next;
      changed = true;
    }
  });

  if (changed) saveSensorOrder();
}

function applySensorOrderToGroupedSensors(groupedSensors) {
  const ordered = createEmptyGroupedBuckets();
  ensureSensorOrderDefaults(groupedSensors);

  Object.keys(groupedSensors || {}).forEach((group) => {
    const sensors = Array.isArray(groupedSensors[group]) ? groupedSensors[group] : [];
    const order = Array.isArray(sensorOrderByGroup[group]) ? sensorOrderByGroup[group] : [];
    const sensorById = new Map(sensors.map((sensor) => [sensor.id, sensor]));
    const arranged = order.map((id) => sensorById.get(id)).filter(Boolean);
    const arrangedSet = new Set(arranged.map((sensor) => sensor.id));
    const leftovers = sensors.filter((sensor) => !arrangedSet.has(sensor.id));
    ordered[group] = [...arranged, ...leftovers];
  });

  return ordered;
}

function moveSensorOrder(group, sensorId, direction) {
  if (!group || !sensorId) return;

  const list = Array.isArray(sensorOrderByGroup[group]) ? [...sensorOrderByGroup[group]] : [];
  const index = list.indexOf(sensorId);
  if (index === -1) return;

  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= list.length) return;

  [list[index], list[targetIndex]] = [list[targetIndex], list[index]];
  sensorOrderByGroup[group] = list;
  saveSensorOrder();
  sensorCatalogSignature = '';
  liveSensorCatalogSignature = '';
  updateStats();
}

function moveSensorOrderByDrop(group, sensorId, targetSensorId, placeAfter) {
  if (!group || !sensorId || !targetSensorId || sensorId === targetSensorId) return;

  const list = Array.isArray(sensorOrderByGroup[group]) ? [...sensorOrderByGroup[group]] : [];
  const fromIndex = list.indexOf(sensorId);
  const targetIndex = list.indexOf(targetSensorId);
  if (fromIndex === -1 || targetIndex === -1) return;

  const [moved] = list.splice(fromIndex, 1);
  let insertIndex = list.indexOf(targetSensorId);
  if (insertIndex === -1) return;
  if (placeAfter) insertIndex += 1;
  list.splice(insertIndex, 0, moved);

  sensorOrderByGroup[group] = list;
  saveSensorOrder();
  sensorCatalogSignature = '';
  liveSensorCatalogSignature = '';
  updateStats();
}

function loadProviderSelection() {
  try {
    const raw = localStorage.getItem(PROVIDER_SELECTION_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      rtss: parsed.rtss !== false,
      aida64: parsed.aida64 !== false,
      hwinfo: parsed.hwinfo !== false
    };
  } catch (e) {
    return { rtss: true, aida64: true, hwinfo: true };
  }
}

function saveProviderSelection(selection) {
  localStorage.setItem(PROVIDER_SELECTION_KEY, JSON.stringify(selection));
}

function loadWindowOrder() {
  try {
    const raw = localStorage.getItem(WINDOW_ORDER_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveWindowOrder(order) {
  localStorage.setItem(WINDOW_ORDER_KEY, JSON.stringify(order || []));
}

function loadWindowSizes() {
  try {
    const raw = localStorage.getItem(WINDOW_SIZE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveWindowSizes(sizeMap) {
  localStorage.setItem(WINDOW_SIZE_KEY, JSON.stringify(sizeMap || {}));
}

function loadSettingsAccordionState() {
  try {
    const raw = localStorage.getItem(SETTINGS_ACCORDION_STATE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

function saveSettingsAccordionState(state) {
  localStorage.setItem(SETTINGS_ACCORDION_STATE_KEY, JSON.stringify(state || {}));
}

function isSetupGuideSuppressed() {
  return localStorage.getItem(SETUP_GUIDE_SUPPRESS_KEY) === 'true';
}

function setSetupGuideSuppressed(suppressed) {
  localStorage.setItem(SETUP_GUIDE_SUPPRESS_KEY, suppressed ? 'true' : 'false');
}

function setSetupGuideModalVisible(visible) {
  const modal = document.getElementById('setupGuideModal');
  if (!modal) return;
  modal.classList.toggle('is-hidden', !visible);
}

function openSetupGuideModal() {
  const checkbox = document.getElementById('setupGuideDontShowAgain');
  if (checkbox) {
    checkbox.checked = isSetupGuideSuppressed();
  }
  setSetupGuideModalVisible(true);
}

function closeSetupGuideModal() {
  const checkbox = document.getElementById('setupGuideDontShowAgain');
  if (checkbox) {
    setSetupGuideSuppressed(!!checkbox.checked);
  }
  setSetupGuideModalVisible(false);
}

function initializeSetupGuideModal() {
  const modal = document.getElementById('setupGuideModal');
  if (!modal || modal.dataset.initialized === 'true') return;

  modal.dataset.initialized = 'true';

  modal.querySelectorAll('[data-close-setup-guide]').forEach((button) => {
    button.addEventListener('click', () => {
      closeSetupGuideModal();
    });
  });

  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeSetupGuideModal();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (modal.classList.contains('is-hidden')) return;
    closeSetupGuideModal();
  });

  if (!isSetupGuideSuppressed()) {
    openSetupGuideModal();
  }
}

function setImportSettingsModalVisible(visible) {
  const modal = document.getElementById('importSettingsModal');
  if (!modal) return;
  modal.classList.toggle('is-hidden', !visible);
}

function closeImportSettingsModal() {
  setImportSettingsModalVisible(false);
}

function applyImportedSettingsNow() {
  const modal = document.getElementById('importSettingsModal');
  if (!modal) return;
  let parsed = {};
  try { parsed = JSON.parse(modal.dataset.parsed || '{}'); } catch (e) { parsed = {}; }

  Object.keys(parsed || {}).forEach((k) => {
    try {
      const v = parsed[k];
      if (v === null || v === undefined) {
        localStorage.removeItem(k);
      } else {
        localStorage.setItem(k, String(v));
      }
    } catch (e) {}
  });

  // Apply immediate visual settings where possible
  try {
    if (parsed.theme) ThemeManager.setTheme(String(parsed.theme).replace(/^"|"$/g, ''));
    // update theme button active state
    try {
      const themeButtons = document.querySelectorAll('.theme-btn');
      if (themeButtons && themeButtons.length && parsed.theme) {
        themeButtons.forEach((b) => b.classList.remove('active'));
        const btn = document.querySelector(`.theme-btn[data-theme="${String(parsed.theme).replace(/^"|"$/g, '')}"]`);
        if (btn) btn.classList.add('active');
      }
    } catch (e) {}
  } catch (e) {}
  try {
    if (parsed[ CUSTOM_COLORS_KEY ]) {
      const raw = parsed[ CUSTOM_COLORS_KEY ];
      let colors = null;
      try { colors = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { colors = null; }
      if (colors) CustomColorManager.applyColors(colors);
    }
  } catch (e) {}

  try { if (parsed[VIEW_MODE_KEY]) applyViewMode(String(parsed[VIEW_MODE_KEY]).replace(/^"|"$/g, ''), { persist: true }); } catch (e) {}
  try { if (parsed[FONT_SIZE_KEY]) applyFontSize(String(parsed[FONT_SIZE_KEY]).replace(/^"|"$/g, '')); } catch (e) {}
  try { const fontSizeSelect = document.getElementById('fontSizeSelect'); if (fontSizeSelect && parsed[FONT_SIZE_KEY]) fontSizeSelect.value = String(parsed[FONT_SIZE_KEY]).replace(/^"|"$/g, ''); } catch (e) {}
  try { if (parsed[FONT_FAMILY_KEY]) applyFontFamily(String(parsed[FONT_FAMILY_KEY]).replace(/^"|"$/g, '')); } catch (e) {}
  try { const fontFamilySelect = document.getElementById('fontFamilySelect'); if (fontFamilySelect && parsed[FONT_FAMILY_KEY]) fontFamilySelect.value = String(parsed[FONT_FAMILY_KEY]).replace(/^"|"$/g, ''); } catch (e) {}
  try { if (parsed[VALUE_FONT_MONOSPACE_KEY]) applyValueFontMonospace(String(parsed[VALUE_FONT_MONOSPACE_KEY]).replace(/^"|"$/g, '') === 'true'); } catch (e) {}
  try { const valueFontMonospaceToggle = document.getElementById('valueFontMonospaceToggle'); if (valueFontMonospaceToggle && parsed[VALUE_FONT_MONOSPACE_KEY]) valueFontMonospaceToggle.checked = String(parsed[VALUE_FONT_MONOSPACE_KEY]).replace(/^"|"$/g, '') === 'true'; } catch (e) {}
  try { if (parsed[FONT_BOLD_KEY]) applyFontBold(String(parsed[FONT_BOLD_KEY]).replace(/^"|"$/g, '') === 'true'); } catch (e) {}
  try { const fontBoldToggle = document.getElementById('fontBoldToggle'); if (fontBoldToggle && parsed[FONT_BOLD_KEY]) fontBoldToggle.checked = String(parsed[FONT_BOLD_KEY]).replace(/^"|"$/g, '') === 'true'; } catch (e) {}
  try { if (parsed[TEMPERATURE_UNIT_KEY]) applyTemperatureUnit(String(parsed[TEMPERATURE_UNIT_KEY]).replace(/^"|"$/g, '')); } catch (e) {}
  try { const tempSelect = document.getElementById('temperatureUnitSelect'); if (tempSelect && parsed[TEMPERATURE_UNIT_KEY]) tempSelect.value = String(parsed[TEMPERATURE_UNIT_KEY]).replace(/^"|"$/g, ''); } catch (e) {}

  // Apply sensor selections / categories / order immediately if present
  try {
    if (parsed[SENSOR_SELECTION_KEY]) {
      let sel = parsed[SENSOR_SELECTION_KEY];
      let selObj = {};
      try { selObj = typeof sel === 'string' ? JSON.parse(sel) : (sel || {}); } catch (e) { selObj = {}; }
      sensorSelection = selObj || {};
      saveSensorSelection();
      try { renderSensorOptions(cachedOrderedSensorCatalog); } catch (e) {}
      try {
        latestSelectedGroupedSensors = filterSelectedSensors(cachedOrderedSensorCatalog || createEmptyGroupedBuckets());
        renderAllDynamicGroups(latestSelectedGroupedSensors, { force: true });
      } catch (e) {}
    }
  } catch (e) {}

  try {
    if (parsed[SENSOR_CATEGORY_SELECTION_KEY]) {
      let cat = parsed[SENSOR_CATEGORY_SELECTION_KEY];
      let catObj = {};
      try { catObj = typeof cat === 'string' ? JSON.parse(cat) : (cat || {}); } catch (e) { catObj = {}; }
      sensorCategorySelection = catObj || {};
      saveSensorCategorySelection();
      try { renderSensorOptions(cachedOrderedSensorCatalog); } catch (e) {}
      try {
        latestSelectedGroupedSensors = filterSelectedSensors(cachedOrderedSensorCatalog || createEmptyGroupedBuckets());
        renderAllDynamicGroups(latestSelectedGroupedSensors, { force: true });
      } catch (e) {}
    }
  } catch (e) {}

  try {
    if (parsed[SENSOR_ORDER_KEY]) {
      let ord = parsed[SENSOR_ORDER_KEY];
      let ordObj = {};
      try { ordObj = typeof ord === 'string' ? JSON.parse(ord) : (ord || {}); } catch (e) { ordObj = {}; }
      sensorOrderByGroup = ordObj || {};
      saveSensorOrder();
      try { renderSensorOptions(cachedOrderedSensorCatalog); } catch (e) {}
    }
  } catch (e) {}

  closeImportSettingsModal();
}

function applyImportedSettingsAndReload() {
  const modal = document.getElementById('importSettingsModal');
  if (!modal) return;
  let parsed = {};
  try { parsed = JSON.parse(modal.dataset.parsed || '{}'); } catch (e) { parsed = {}; }

  Object.keys(parsed || {}).forEach((k) => {
    try {
      const v = parsed[k];
      if (v === null || v === undefined) {
        localStorage.removeItem(k);
      } else {
        localStorage.setItem(k, String(v));
      }
    } catch (e) {}
  });
  location.reload();
}

function initializeImportSettingsModal() {
  const modal = document.getElementById('importSettingsModal');
  if (!modal || modal.dataset.initialized === 'true') return;
  modal.dataset.initialized = 'true';

  const applyBtn = modal.querySelector('#applyImportedNowBtn');
  const applyReloadBtn = modal.querySelector('#applyImportedReloadBtn');
  const cancelBtn = modal.querySelector('#cancelImportedBtn');
  const headerCloseBtns = modal.querySelectorAll('.setup-guide-close');

  if (applyBtn) applyBtn.addEventListener('click', applyImportedSettingsNow);
  if (applyReloadBtn) applyReloadBtn.addEventListener('click', applyImportedSettingsAndReload);
  if (cancelBtn) cancelBtn.addEventListener('click', closeImportSettingsModal);
  if (headerCloseBtns && headerCloseBtns.length) {
    headerCloseBtns.forEach((b) => b.addEventListener('click', closeImportSettingsModal));
  }

  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeImportSettingsModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (modal.classList.contains('is-hidden')) return;
    closeImportSettingsModal();
  });
}

function setSettingsSectionExpanded(section, toggleButton, expanded) {
  section.classList.toggle('is-collapsed', !expanded);
  toggleButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

function setupSettingsAccordion() {
  const sections = Array.from(document.querySelectorAll('.sidebar .settings-section'));
  if (!sections.length) return;

  const savedState = loadSettingsAccordionState();

  sections.forEach((section, index) => {
    if (section.dataset.accordionReady === 'true') return;

    const labelEl = section.querySelector(':scope > .settings-label');
    const sectionTitle = labelEl ? labelEl.textContent.trim() : `Section ${index + 1}`;
    const labelIcon = labelEl ? labelEl.querySelector('.settings-label-icon') : null;
    const sectionTitleIconClass = labelIcon && labelIcon.className ? labelIcon.className : '';
    const sectionKey = sectionTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `section_${index + 1}`;

    const contentWrap = document.createElement('div');
    contentWrap.className = 'settings-section-content';

    const moveNodes = Array.from(section.children).filter((child) => child !== labelEl);
    moveNodes.forEach((child) => contentWrap.appendChild(child));

    if (labelEl) labelEl.remove();

    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'settings-toggle-btn';
    const titleIconHtml = sectionTitleIconClass
      ? `<i class="${escapeHtml(sectionTitleIconClass)}" aria-hidden="true"></i>`
      : '';
    toggleButton.innerHTML = `<span class="settings-toggle-title">${titleIconHtml}<span>${escapeHtml(sectionTitle)}</span></span><span class="settings-toggle-icon" aria-hidden="true">▾</span>`;

    const isExpanded = savedState[sectionKey] !== undefined ? !!savedState[sectionKey] : false;
    setSettingsSectionExpanded(section, toggleButton, isExpanded);

    toggleButton.addEventListener('click', () => {
      const nextExpanded = section.classList.contains('is-collapsed');
      setSettingsSectionExpanded(section, toggleButton, nextExpanded);
      savedState[sectionKey] = nextExpanded;
      saveSettingsAccordionState(savedState);
    });

    section.dataset.accordionReady = 'true';
    section.dataset.sectionKey = sectionKey;
    section.appendChild(toggleButton);
    section.appendChild(contentWrap);
  });
}

function normalizeSidebarWidth(width) {
  const numeric = Number(width);
  if (!Number.isFinite(numeric)) return 300;
  const dynamicMax = Math.max(380, Math.floor(window.innerWidth * 0.7));
  return Math.max(300, Math.min(dynamicMax, Math.round(numeric)));
}

function loadSidebarWidth() {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? normalizeSidebarWidth(parsed) : null;
  } catch (error) {
    return null;
  }
}

function saveSidebarWidth(width) {
  const normalized = normalizeSidebarWidth(width);
  localStorage.setItem(SIDEBAR_WIDTH_KEY, String(normalized));
  return normalized;
}

function setupSidebarResize() {
  const sidebar = document.querySelector('.sidebar');
  const handle = document.getElementById('sidebarResizeHandle');
  if (!sidebar || !handle) return;

  const applyWidth = (width) => {
    const normalized = normalizeSidebarWidth(width);
    sidebar.style.width = `${normalized}px`;
    sidebar.style.minWidth = `${normalized}px`;
  };

  const applySavedWidth = () => {
    if (window.innerWidth <= 768) {
      sidebar.style.removeProperty('width');
      sidebar.style.removeProperty('min-width');
      return;
    }

    const saved = loadSidebarWidth();
    if (saved !== null) {
      applyWidth(saved);
    }
  };

  applySavedWidth();

  handle.addEventListener('mousedown', (event) => {
    if (window.innerWidth <= 768) return;
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = sidebar.getBoundingClientRect().width;
    document.body.classList.add('sidebar-resizing');

    const onMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      applyWidth(startWidth + deltaX);
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('sidebar-resizing');
      saveSidebarWidth(sidebar.getBoundingClientRect().width);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth <= 768) {
      sidebar.style.removeProperty('width');
      sidebar.style.removeProperty('min-width');
      return;
    }

    const saved = loadSidebarWidth();
    if (saved === null) return;
    const normalized = normalizeSidebarWidth(saved);
    applyWidth(normalized);
    saveSidebarWidth(normalized);
  });
}

function applyWindowSizes() {
  const sizes = loadWindowSizes();
  const container = document.getElementById('statsContainer');
  const columns = container
    ? Math.max(1, getComputedStyle(container).gridTemplateColumns.split(' ').filter(Boolean).length)
    : 1;

  const cards = document.querySelectorAll('.sensor-group');
  cards.forEach((card) => {
    const savedEntry = sizes[card.id];
    const savedHeight = Number(typeof savedEntry === 'object' ? savedEntry.height : savedEntry);
    const savedSpan = Number(typeof savedEntry === 'object' ? savedEntry.span : 1);

    if (Number.isFinite(savedHeight) && savedHeight >= 220 && savedHeight <= 900) {
      card.style.height = `${savedHeight}px`;
    }

    if (Number.isFinite(savedSpan) && savedSpan >= 1) {
      const normalizedSpan = Math.min(Math.max(1, Math.round(savedSpan)), columns);
      card.style.gridColumn = `span ${normalizedSpan}`;
    }
  });
}

function setupWindowResize() {
  const cards = Array.from(document.querySelectorAll('.sensor-group'));
  const sizeMap = loadWindowSizes();
  const heightSnap = 20;

  const snapToStep = (value, step, min, max) => {
    const snapped = Math.round(value / step) * step;
    return Math.max(min, Math.min(max, snapped));
  };

  cards.forEach((card) => {
    if (!card.id) return;

    let handle = card.querySelector('.sensor-resize-handle');
    if (!handle) {
      handle = document.createElement('div');
      handle.className = 'sensor-resize-handle';
      card.appendChild(handle);
    }

    handle.onmousedown = (event) => {
      if (summaryModeEnabled) return;
      event.preventDefault();
      event.stopPropagation();

      const container = document.getElementById('statsContainer');
      const containerStyles = container ? getComputedStyle(container) : null;
      const columns = containerStyles
        ? Math.max(1, containerStyles.gridTemplateColumns.split(' ').filter(Boolean).length)
        : 1;
      const gap = containerStyles ? (parseFloat(containerStyles.columnGap || containerStyles.gap || '14') || 14) : 14;
      const containerWidth = container ? container.clientWidth : card.getBoundingClientRect().width;
      const columnWidth = Math.max(220, (containerWidth - (gap * (columns - 1))) / columns);

      const startX = event.clientX;
      const startY = event.clientY;
      const startWidth = card.getBoundingClientRect().width;
      const startHeight = card.getBoundingClientRect().height;
      const minHeight = 220;
      const maxHeight = Math.min(window.innerHeight - 120, 900);
      const currentSpanMatch = (card.style.gridColumn || '').match(/span\s+(\d+)/i);
      const startSpan = currentSpanMatch ? parseInt(currentSpanMatch[1], 10) : 1;

      card.classList.add('resizing');
      card.draggable = false;

      const onMove = (moveEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const delta = moveEvent.clientY - startY;
        const nextHeight = snapToStep(startHeight + delta, heightSnap, minHeight, maxHeight);
        card.style.height = `${Math.round(nextHeight)}px`;

        const desiredWidth = Math.max(columnWidth, startWidth + deltaX);
        const rawSpan = Math.round((desiredWidth + gap) / (columnWidth + gap));
        const nextSpan = Math.min(Math.max(1, rawSpan || startSpan), columns);
        card.style.gridColumn = `span ${nextSpan}`;
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        card.classList.remove('resizing');
        card.draggable = true;

        const finalHeight = snapToStep(card.getBoundingClientRect().height, heightSnap, minHeight, maxHeight);
        const finalSpanMatch = (card.style.gridColumn || '').match(/span\s+(\d+)/i);
        const finalSpan = finalSpanMatch ? Math.max(1, parseInt(finalSpanMatch[1], 10)) : 1;

        sizeMap[card.id] = {
          height: finalHeight,
          span: finalSpan
        };
        saveWindowSizes(sizeMap);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };
  });
}

function applyWindowOrder() {
  const container = document.getElementById('statsContainer');
  if (!container) return;

  const cards = Array.from(container.querySelectorAll('.sensor-group'));
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const savedOrder = loadWindowOrder();
  const validSavedOrder = savedOrder.filter((id) => cardById.has(id));
  const missing = cards.map((card) => card.id).filter((id) => !validSavedOrder.includes(id));
  const finalOrder = [...validSavedOrder, ...missing];

  finalOrder.forEach((id) => {
    const card = cardById.get(id);
    if (card) container.appendChild(card);
  });

  saveWindowOrder(finalOrder);
}

function setupWindowDragAndDrop() {
  const container = document.getElementById('statsContainer');
  if (!container) return;

  let draggedId = null;
  let draggedCard = null;
  let dropTargetId = null;
  let dropBefore = true;
  const cards = Array.from(container.querySelectorAll('.sensor-group'));

  const persistOrder = () => {
    const nextOrder = Array.from(container.querySelectorAll('.sensor-group')).map((group) => group.id);
    saveWindowOrder(nextOrder);
  };

  const clearDropIndicators = () => {
    cards.forEach((entry) => entry.classList.remove('drag-over-before', 'drag-over-after'));
    container.classList.remove('drag-over-end');
    dropTargetId = null;
  };

  const setDropIndicator = (targetCard, before) => {
    if (!targetCard || targetCard === draggedCard) return;
    if (dropTargetId === targetCard.id && dropBefore === before) return;

    clearDropIndicators();
    dropTargetId = targetCard.id;
    dropBefore = before;

    targetCard.classList.add(before ? 'drag-over-before' : 'drag-over-after');
  };

  cards.forEach((card) => {
    card.draggable = true;

    card.addEventListener('dragstart', (event) => {
      if (summaryModeEnabled) {
        event.preventDefault();
        return;
      }
      draggedId = card.id;
      draggedCard = card;
      dropTargetId = null;
      dropBefore = true;
      card.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', card.id);
    });

    card.addEventListener('dragend', () => {
      draggedId = null;
      draggedCard = null;
      cards.forEach((entry) => entry.classList.remove('dragging'));
      clearDropIndicators();
    });
  });

  container.addEventListener('dragover', (event) => {
    if (summaryModeEnabled) return;
    event.preventDefault();
    if (!draggedId) return;

    const targetCard = event.target.closest('.sensor-group');
    if (!targetCard || targetCard === draggedCard) {
      clearDropIndicators();
      container.classList.add('drag-over-end');
    } else {
      container.classList.remove('drag-over-end');
      const rect = targetCard.getBoundingClientRect();
      const before = event.clientY < rect.top + (rect.height / 2);
      setDropIndicator(targetCard, before);
    }
    event.dataTransfer.dropEffect = 'move';
  });

  container.addEventListener('drop', (event) => {
    if (summaryModeEnabled) return;
    event.preventDefault();
    if (!draggedId) return;

    const sourceId = event.dataTransfer.getData('text/plain') || draggedId;
    const sourceCard = document.getElementById(sourceId);
    if (!sourceCard) return;

    if (dropTargetId && dropTargetId !== sourceId) {
      const targetCard = document.getElementById(dropTargetId);
      if (targetCard) {
        if (dropBefore) {
          container.insertBefore(sourceCard, targetCard);
        } else {
          container.insertBefore(sourceCard, targetCard.nextSibling);
        }
      }
      persistOrder();
    } else if (container.classList.contains('drag-over-end')) {
      container.appendChild(sourceCard);
      persistOrder();
    }

    clearDropIndicators();
  });
}

function applyFontSize(size) {
  const normalized = ['small', 'medium', 'large', 'xlarge', 'xxlarge'].includes(size) ? size : 'medium';
  document.body.classList.remove('font-small', 'font-medium', 'font-large', 'font-xlarge', 'font-xxlarge');
  document.body.classList.add(`font-${normalized}`);
  localStorage.setItem(FONT_SIZE_KEY, normalized);
}

function applyFontFamily(family) {
  const normalized = Object.prototype.hasOwnProperty.call(FONT_FAMILY_MAP, family) ? family : 'segoe';
  const fontFamily = FONT_FAMILY_MAP[normalized];
  document.body.style.setProperty('--font-family', fontFamily);
  const useMonospaceValues = localStorage.getItem(VALUE_FONT_MONOSPACE_KEY) === 'true';
  document.body.style.setProperty('--value-font-family', useMonospaceValues ? VALUE_MONOSPACE_FONT_STACK : fontFamily);
  localStorage.setItem(FONT_FAMILY_KEY, normalized);
}

function applyValueFontMonospace(enabled) {
  const isEnabled = !!enabled;
  const selectedFontFamilyKey = localStorage.getItem(FONT_FAMILY_KEY) || 'segoe';
  const selectedFontFamily = FONT_FAMILY_MAP[selectedFontFamilyKey] || FONT_FAMILY_MAP.segoe;
  document.body.style.setProperty('--value-font-family', isEnabled ? VALUE_MONOSPACE_FONT_STACK : selectedFontFamily);
  localStorage.setItem(VALUE_FONT_MONOSPACE_KEY, isEnabled ? 'true' : 'false');
}

function applyFontBold(enabled) {
  if (enabled) {
    document.body.classList.add('font-bold');
  } else {
    document.body.classList.remove('font-bold');
  }
  localStorage.setItem(FONT_BOLD_KEY, enabled ? 'true' : 'false');
}

function normalizeTemperatureUnit(unit) {
  return String(unit || '').trim().toLowerCase() === 'f' ? 'f' : 'c';
}

function celsiusToFahrenheit(value) {
  return (value * 9 / 5) + 32;
}

function fahrenheitToCelsius(value) {
  return (value - 32) * 5 / 9;
}

function applyTemperatureUnit(unit, options = {}) {
  const persist = options.persist !== false;
  const normalized = normalizeTemperatureUnit(unit);

  if (persist) {
    localStorage.setItem(TEMPERATURE_UNIT_KEY, normalized);
  }

  const unitSelect = document.getElementById('temperatureUnitSelect');
  if (unitSelect && unitSelect.value !== normalized) {
    unitSelect.value = normalized;
  }

  invalidateRenderGroupCache();
  updateStats(true);

  return normalized;
}

function normalizeViewMode(mode) {
  const normalized = String(mode || '').trim().toLowerCase();
  if (normalized === 'compact' || normalized === 'wide' || normalized === 'glass' || normalized === 'terminal') return normalized;
  return 'standard';
}

function getNextViewMode(currentMode) {
  const normalizedCurrent = normalizeViewMode(currentMode);
  const currentIndex = VIEW_MODE_SEQUENCE.indexOf(normalizedCurrent);
  const nextIndex = (currentIndex + 1) % VIEW_MODE_SEQUENCE.length;
  return VIEW_MODE_SEQUENCE[nextIndex];
}

function applyDesktopGroupIconsForViewMode(mode) {
  const normalized = normalizeViewMode(mode);
  const modeIcons = VIEW_MODE_GROUP_ICONS[normalized] || VIEW_MODE_GROUP_ICONS.standard;

  SENSOR_GROUP_ORDER.forEach((group) => {
    const cardId = GROUP_CARD_IDS[group];
    if (!cardId) return;
    const card = document.getElementById(cardId);
    if (!card) return;
    const icon = card.querySelector('.group-icon');
    if (!icon) return;

    const iconClass = modeIcons[group] || VIEW_MODE_GROUP_ICONS.standard[group] || 'bi-circle-fill';
    icon.className = `bi ${iconClass} group-icon`;
  });
}

function applyViewMode(mode, options = {}) {
  const persist = options.persist !== false;
  const normalized = normalizeViewMode(mode);

  document.body.classList.remove('view-compact', 'view-wide', 'view-glass', 'view-terminal');
  if (normalized !== 'standard') {
    document.body.classList.add(`view-${normalized}`);
  }

  if (persist) {
    localStorage.setItem(VIEW_MODE_KEY, normalized);
  }

  const button = document.getElementById('viewModeBtn');
  if (button) {
    button.textContent = `Style: ${VIEW_MODE_LABELS[normalized] || VIEW_MODE_LABELS.standard}`;
  }

  applyDesktopGroupIconsForViewMode(normalized);

  if (!summaryModeEnabled) {
    applyWindowSizes();
  }

  invalidateRenderGroupCache();
  renderAllDynamicGroups(latestSelectedGroupedSensors || createEmptyGroupedBuckets(), { force: true });

  return normalized;
}

function applyMonitoringMode(enabled) {
  if (enabled) {
    document.body.classList.add('monitoring-mode');
  } else {
    document.body.classList.remove('monitoring-mode');
  }

  localStorage.setItem(MONITORING_MODE_KEY, enabled ? 'true' : 'false');

  const button = document.getElementById('monitoringModeBtn');
  if (button) {
    // Use a settings gear icon for the button; toggle tooltip and active state
    button.innerHTML = '<i class="bi bi-gear" aria-hidden="true"></i>';
    button.title = enabled ? 'Close Settings' : 'Open Settings';
    button.classList.toggle('active', !!enabled);
  }
}

function invalidateRenderGroupCache() {
  Object.keys(renderGroupSignatureCache).forEach((key) => {
    delete renderGroupSignatureCache[key];
  });
  forceNextUiRender = true;
}

function applySummaryCardLayout() {
  const container = document.getElementById('statsContainer');
  if (!container) return;

  SENSOR_GROUP_ORDER.forEach((group) => {
    const cardId = GROUP_CARD_IDS[group];
    const card = cardId ? document.getElementById(cardId) : null;
    if (!card) return;

    card.style.gridColumn = '';
    card.style.height = '';
    container.appendChild(card);
  });
}

function syncCardInteractionState() {
  const cards = document.querySelectorAll('.sensor-group');
  cards.forEach((card) => {
    card.draggable = !summaryModeEnabled;
  });
}

function applySummaryMode(enabled) {
  summaryModeEnabled = !!enabled;
  document.body.classList.toggle('summary-mode', summaryModeEnabled);
  localStorage.setItem(SUMMARY_MODE_KEY, summaryModeEnabled ? 'true' : 'false');

  const button = document.getElementById('summaryModeBtn');
  if (button) {
    button.textContent = summaryModeEnabled ? 'Exit Summary Mode' : 'Summary Mode';
  }

  if (summaryModeEnabled) {
    applySummaryCardLayout();
  } else {
    applyWindowOrder();
    applyWindowSizes();
  }

  syncCardInteractionState();

  invalidateRenderGroupCache();
  renderAllDynamicGroups(latestSelectedGroupedSensors || createEmptyGroupedBuckets(), { force: true });
}

// Low Overhead Mode internals removed to clean up unused feature.

function sensorCatalogHash(groupedSensors) {
  const keys = Object.keys(groupedSensors || {}).sort();
  const parts = [];
  for (const key of keys) {
    const sensors = (groupedSensors[key] || [])
      .map((sensor) => `${sensor.id}:${getFinalDisplayLabel(sensor)}`)
      .sort();
    parts.push(`${key}:${sensors.join(',')}`);
  }
  return parts.join('|');
}

function getFinalDisplayLabel(sensor) {
  const raw = String(sensor && sensor.name ? sensor.name : '').trim();
  if (!raw) return 'Sensor';

  const sensorId = String(sensor && sensor.id ? sensor.id : '').trim();
  const customName = sensorId ? String(sensorCustomNames[sensorId] || '').trim() : '';
  if (customName) return customName;

  const lower = raw.toLowerCase();
  const group = String(sensor && sensor.group ? sensor.group : '').toLowerCase();
  const units = String(resolveDisplayUnits(sensor) || '').toLowerCase();

  if (lower === 'external ip address') return 'WAN IP';
  if (lower === 'primary ip address') return 'LAN IP';

  if (lower.includes('cpu sensor')) {
    if (units === 'w') return 'CPU Power';
    if (units === 'rpm' || group === 'fans') return 'CPU Fan';
    if (units === '%') return 'CPU Usage';
    return 'CPU Temp';
  }

  if (lower === 'gpu sensor' || lower === 'gpu sensor (2)') {
    if (units === 'w') return 'GPU Power';
    if (units === 'rpm' || group === 'fans') return 'GPU Fan';
    if (units === '%') return 'GPU Usage';
    if (units === '°c' || units === 'c') return 'GPU Temp';
    return group === 'gpu' ? 'GPU Temp' : raw;
  }

  return raw;
}

function ensureSensorDefaults(groupedSensors) {
  Object.values(groupedSensors || {}).forEach((list) => {
    (list || []).forEach((sensor) => {
      if (sensorSelection[sensor.id] === undefined) {
        sensorSelection[sensor.id] = true;
      }
    });
  });
}

function ensureCategoryDefaults(groupedSensors) {
  Object.keys(groupedSensors || {}).forEach((group) => {
    if (sensorCategorySelection[group] === undefined) {
      sensorCategorySelection[group] = true;
    }
  });
}

function formatSensorValue(sensor) {
  if (!sensor) return '--';
  const rawValue = sensor.value;
  if (rawValue === null || rawValue === undefined) return '--';

  if (typeof rawValue === 'string') {
    const text = rawValue.trim();
    return text || '--';
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value)) return String(rawValue);

  return formatSensorNumericValue(sensor, value);
}

function formatSensorNumericValue(sensor, numericValue) {
  if (!Number.isFinite(numericValue)) return '--';

  const normalizedForDisplay = normalizeValueForDisplay(sensor, numericValue);
  const units = normalizedForDisplay.units;
  const displayValue = normalizedForDisplay.value;
  const u = units.toLowerCase();

  let decimals = 1;
  if (!units) {
    decimals = Math.abs(numericValue) >= 100 ? 0 : 2;
  } else if (u === 'rpm' || u === 'fps' || u === '%' || u === 'mhz' || u === 'khz' || u === 'hz') {
    decimals = 0;
  } else if (u === 'ms') {
    decimals = 2;
  } else if (u === 'v' || u === 'a' || u === 'w' || u === '°c' || u === 'c' || u === '°f' || u === 'f' || u === 'ghz') {
    decimals = 2;
  } else if (u === 'gb' || u === 'mb' || u === 'kb' || u === 'tb') {
    decimals = 2;
  } else if (u === 'mb/s' || u === 'gb/s' || u === 'kb/s' || u === 'b/s' || u === 'mbps' || u === 'gbps' || u === 'kbps') {
    decimals = 2;
  }

  return `${displayValue.toFixed(decimals)}${units ? ` ${units}` : ''}`;
}

function updateSensorSessionStats(selectedGroupedSensors) {
  Object.values(selectedGroupedSensors || {}).forEach((list) => {
    (list || []).forEach((sensor) => {
      if (!sensor || !sensor.id) return;

      const value = Number(sensor.value);
      if (!Number.isFinite(value)) return;

      if (!sensorSessionStats[sensor.id]) {
        sensorSessionStats[sensor.id] = {
          min: value,
          max: value,
          sum: value,
          count: 1
        };
        return;
      }

      const stats = sensorSessionStats[sensor.id];
      stats.min = Math.min(stats.min, value);
      stats.max = Math.max(stats.max, value);
      stats.sum += value;
      stats.count += 1;
    });
  });
}

function renderSensorSummary(sensor) {
  const stats = sensor && sensor.id ? sensorSessionStats[sensor.id] : null;
  if (!stats || !Number.isFinite(stats.min) || !Number.isFinite(stats.max) || !Number.isFinite(stats.count) || stats.count <= 0) {
    const rawValue = sensor ? sensor.value : null;
    if (typeof rawValue === 'string') {
      const staticText = rawValue.trim() || '--';
      return `<div class="stat-summary-line is-empty"><span class="summary-metric"><span class="summary-metric-label">Value</span><span class="summary-metric-value">${escapeHtml(staticText)}</span></span></div>`;
    }
    return '<div class="stat-summary-line is-empty">Collecting summary...</div>';
  }

  const minText = formatSensorNumericValue(sensor, stats.min);
  const maxText = formatSensorNumericValue(sensor, stats.max);

  return `
    <div class="stat-summary-line" aria-label="Session summary">
      <span class="summary-metric"><span class="summary-metric-label">Min</span><span class="summary-metric-value">${escapeHtml(minText)}</span></span>
      <span class="summary-separator">•</span>
      <span class="summary-metric"><span class="summary-metric-label">Max</span><span class="summary-metric-value">${escapeHtml(maxText)}</span></span>
    </div>
  `;
}

function normalizeValueForDisplay(sensor, numericValue) {
  const units = resolveDisplayUnits(sensor);
  const name = String(sensor && sensor.name ? sensor.name : '').toLowerCase();
  const group = String(sensor && sensor.group ? sensor.group : '').toLowerCase();

  let value = numericValue;
  let displayUnits = units;

  const preferredTempUnit = normalizeTemperatureUnit(localStorage.getItem(TEMPERATURE_UNIT_KEY));
  const lowerInitialUnits = String(displayUnits || '').toLowerCase().replace(/°/g, '');
  if (lowerInitialUnits === 'c' && preferredTempUnit === 'f') {
    value = celsiusToFahrenheit(value);
    displayUnits = '°F';
  } else if (lowerInitialUnits === 'f' && preferredTempUnit === 'c') {
    value = fahrenheitToCelsius(value);
    displayUnits = '°C';
  }

  if (group === 'network') {
    if ((name.includes('download rate') || name.includes('upload rate')) && (!sensor.units || !String(sensor.units).trim())) {
      displayUnits = 'KB/s';
    }
    if (name.includes('connection speed') && (!sensor.units || !String(sensor.units).trim())) {
      displayUnits = 'Mbps';
    }

    const lowerDisplayUnits = String(displayUnits || '').toLowerCase();
    if (lowerDisplayUnits === 'kb/s' && Math.abs(value) >= 1024) {
      value = value / 1024;
      displayUnits = 'MB/s';
    }
    if (String(displayUnits || '').toLowerCase() === 'mb/s' && Math.abs(value) >= 1024) {
      value = value / 1024;
      displayUnits = 'GB/s';
    }

    const isNetworkTotal =
      name.includes('total download') ||
      name.includes('total upload') ||
      name.includes('total dl') ||
      name.includes('total up');

    if (isNetworkTotal && String(displayUnits || '').toLowerCase() === 'mb' && Math.abs(value) >= 1024) {
      value = value / 1024;
      displayUnits = 'GB';
    }
  }

  if (group === 'ram' && name.includes('memory speed')) {
    displayUnits = 'GHz';
  }

  const lowerDisplayUnits = String(displayUnits || '').toLowerCase();
  const isMemoryReading =
    name.includes('memory') ||
    name.includes('vram') ||
    name.includes('dedicated') ||
    name.includes('dynamic') ||
    name.includes('ram usage') ||
    (group === 'ram') ||
    (group === 'gpu' && name.includes('memory'));

  if (isMemoryReading) {
    let memoryMb = null;
    if (lowerDisplayUnits === 'kb') {
      memoryMb = value / 1024;
    } else if (lowerDisplayUnits === 'mb') {
      memoryMb = value;
    } else if (lowerDisplayUnits === 'gb') {
      memoryMb = Math.abs(value) >= 1024 ? value : (value * 1024);
    } else if (lowerDisplayUnits === 'tb') {
      memoryMb = value * 1024 * 1024;
    }

    if (Number.isFinite(memoryMb)) {
      if (Math.abs(memoryMb) < 1024) {
        value = memoryMb;
        displayUnits = 'MB';
      } else {
        value = memoryMb / 1024;
        displayUnits = 'GB';
      }
    }
  }

  return { value, units: displayUnits };
}

function normalizeSensorUnits(sensor) {
  const rawUnits = String(sensor && sensor.units ? sensor.units : '')
    .replace(/°/g, '')
    .replace(/[�]/g, '')
    .replace(/[^a-zA-Z0-9/%\.\-\s]/g, '')
    .trim();
  const inferred = inferUnitsFromSensor(sensor);
  const source = rawUnits || inferred;
  if (!source) return '';

  const lower = source.toLowerCase();
  const unitMap = {
    c: 'C',
    celcius: 'C',
    celsius: 'C',
    f: 'F',
    rpm: 'RPM',
    'r/min': 'RPM',
    fps: 'FPS',
    percent: '%',
    pct: '%',
    '%': '%',
    ms: 'ms',
    msec: 'ms',
    millisecond: 'ms',
    milliseconds: 'ms',
    mhz: 'MHz',
    ghz: 'GHz',
    khz: 'kHz',
    v: 'V',
    a: 'A',
    w: 'W',
    gb: 'GB',
    mb: 'MB',
    kb: 'KB',
    tb: 'TB',
    'b/s': 'B/s',
    'mb/s': 'MB/s',
    'gb/s': 'GB/s',
    'kb/s': 'KB/s',
    'bytes/s': 'B/s',
    'byte/s': 'B/s',
    mbps: 'Mbps',
    gbps: 'Gbps',
    kbps: 'Kbps',
    x: 'X',
    hz: 'Hz'
  };

  if (unitMap[lower]) return unitMap[lower];
  return source;
}

function resolveDisplayUnits(sensor) {
  const normalized = normalizeSensorUnits(sensor);
  const normalizedLower = String(normalized || '').toLowerCase();
  const name = String(sensor && sensor.name ? sensor.name : '').toLowerCase();
  const group = String(sensor && sensor.group ? sensor.group : '').toLowerCase();
  const sensorId = String(sensor && sensor.id ? sensor.id : '').toLowerCase();
  const value = Number(sensor && sensor.value);
  const hasFiniteValue = Number.isFinite(value);

  if (name.includes('dram:fsb ratio') || name.includes('ratio')) return '';
  if (name.includes('timing')) return '';
  if (name.includes('multiplier')) return 'X';

  if (group === 'fans') return 'RPM';

  if (name.includes('memory clock') || name.includes('gpu memory clock') || name === 'memory clock') return 'MHz';
  if (name.includes('memory speed') && !name.includes('connection')) return 'GHz';
  if (name.includes('dedicated memory') || name.includes('dynamic memory')) return 'MB';

  if (name.includes('used memory') || name.includes('free memory') || name.includes('virtual memory committed') || name.includes('physical memory available')) {
    if (normalizedLower === 'gb' || normalizedLower === 'mb' || normalizedLower === 'kb') return normalized;
    return 'MB';
  }

  if (group === 'cpu' || group === 'gpu') {
    if (group === 'gpu' && name === 'gpu') {
      if (sensorId.includes('pwr') || sensorId.includes('power') || sensorId.includes('ppt') || /(^|[_-])tgp([_-]|$)/.test(sensorId)) return 'W';
      if (sensorId.includes('temp') || sensorId.includes('hot') || sensorId.includes('therm')) return '°C';
      if (sensorId.includes('duty') || sensorId.includes('uti') || sensorId.includes('load')) return '%';
      if (sensorId.includes('fan')) return 'RPM';
    }

    if (group === 'cpu' && (name === 'cpu' || name === 'cpu package')) {
      if (sensorId.includes('pwr') || sensorId.includes('power') || sensorId.includes('ppt')) return 'W';
      if (sensorId.includes('temp') || sensorId.includes('tctl') || sensorId.includes('tdie') || sensorId.includes('pkg')) return '°C';
      if (sensorId.includes('uti') || sensorId.includes('load')) return '%';
    }

    if (name === 'cpu' || name === 'gpu') {
      // MAHM source-id hints for ambiguous generic labels
      if (group === 'cpu') {
        if (/^90_/.test(sensorId)) return '%';
        if (/^80_/.test(sensorId)) return '°C';
        if (/^100_/.test(sensorId)) return 'W';
        if (/^a0_/.test(sensorId)) return 'MHz';
      }

      if (group === 'gpu') {
        if (/^30_/.test(sensorId)) return '%';
        if (/^0_/.test(sensorId)) return '°C';
        if (/^(61|60)_/.test(sensorId)) return 'W';
        if (/^20_/.test(sensorId)) return 'MHz';
        if (/^31_/.test(sensorId)) return 'MB';
      }
    }

    if (name.includes('package') || name.includes('chipset') || name.includes('diode') || name.includes('hotspot') || name.includes('motherboard') || name.includes('ccd')) {
      if (hasFiniteValue && value >= -20 && value <= 130) return '°C';
    }

    if (name.includes('core') && !name.includes('clock') && !name.includes('usage') && !name.includes('load')) {
      if (hasFiniteValue && value >= 0 && value <= 3) return 'V';
    }
  }

  if (group === 'network') {
    if (name.includes('ip address') || name.includes('mac address')) return '';
    if (name.includes('link speed')) return normalized || 'Mbps';
    if (name.includes('connection speed')) return normalized || 'Mbps';
    if (name.includes('download rate') || name.includes('upload rate')) return normalized || 'KB/s';
    if (name.includes('current dl rate') || name.includes('current up rate')) return normalized || 'KB/s';
    if (name.includes('tx') || name.includes('rx') || name.includes('throughput')) return normalized || 'Mbps';
    if (name.includes('total download') || name.includes('total upload') || name.includes('total dl') || name.includes('total up')) return 'MB';
    if (name.includes('speed')) return normalizedLower === 'mb/s' ? 'Mbps' : (normalized || 'Mbps');
    if (name.includes('usage') || name.includes('utilization') || name.includes('load')) return '%';
    return normalized || '';
  }

  if (group === 'drives') {
    if (sensorId.includes('temp') || /thdd\d+/i.test(sensorId)) return '°C';
    if (name.includes('activity') || name.includes('utilization')) return '%';
    if (name.includes('read speed') || name.includes('write speed')) return 'MB/s';
    if (name.includes('used space') || name.includes('free space') || name.includes('total host writes') || name.includes('total host reads') || name.includes('total nand writes')) return 'GB';
    if (name.includes('temperature') || name.includes('temp')) return '°C';
  }

  if (group === 'ram') {
    if (name.includes('memory timings') || name === 'memory timings') return '';
    if (name.includes('temp') || name.includes('temperature') || name.includes('dimm') || name.includes('dram')) return '°C';
    if (name.includes('ram usage')) return 'GB';
    if (name.includes('used memory') || name.includes('free memory') || name.includes('virtual memory') || name.includes('physical memory')) return 'MB';
    if (name.includes('utilization') || name.includes('load')) return '%';
    if (name.includes('memory clock')) return 'MHz';
    if (name.includes('memory speed')) return 'GHz';
  }

  if (group === 'gpu' && name === 'gpu memory') return normalized || 'MB';

  if (group === 'psu') {
    if (sensorId.includes('temp') || sensorId.includes('tpsu')) return '°C';
    if (sensorId.includes('fan') || sensorId.includes('fpsu')) return 'RPM';
    if (sensorId.includes('volt') || sensorId.includes('vpsu') || sensorId.includes('vdd') || sensorId.includes('vbat')) return 'V';
    if (sensorId.includes('curr') || sensorId.includes('cpsu')) return 'A';
    if (sensorId.includes('pwr') || sensorId.includes('ppsu') || sensorId.includes('power')) return 'W';

    if (name.includes('temp')) return '°C';
    if (name.includes('fan')) return 'RPM';
    if (name.includes('+12') || name.includes('+5') || name.includes('+3.3') || name.includes('vbat') || name.includes('voltage') || name.includes('vdd')) return 'V';
    if (name.includes('current')) return 'A';
    if (name.includes('power supply') || name.includes('power')) return 'W';
  }

  if (normalized) {
    if (normalized === 'C') return '°C';
    if (normalized === 'F') return '°F';
    return normalized;
  }

  if (name.includes('vertical refresh rate') || name.includes('refresh rate')) return 'Hz';
  if (name.includes('temp') || name.includes('temperature') || name.includes('diode') || name.includes('hotspot') || name.includes('tctl') || name.includes('tdie')) return '°C';
  if ((name.includes('chipset') || name.includes('ccd') || (name.includes('motherboard') && !name.includes('name'))) && !name.includes('clock')) return '°C';
  if (name.includes('frame time') || name.includes('frametime')) return 'ms';
  if (name.includes('fps') || name.includes('framerate')) return 'FPS';
  if (name.includes('fan')) return 'RPM';
  if (name.includes('power')) return 'W';
  if (name.includes('volt') || name.includes('vdd') || name.includes('vid') || name.includes('vbat') || name.includes('+12 v') || name.includes('+5 v') || name.includes('+3.3 v')) return 'V';
  if (name.includes('current') || name.includes('curr')) return 'A';
  if (name.includes('clock') || name.includes('freq') || name.includes('fsb')) return 'MHz';
  if (name.includes('download') || name.includes('upload') || name.includes('throughput')) return 'MB/s';
  if (name.includes('utilization') || name.includes('usage') || name.includes('load') || name.includes('activity') || name.includes('duty')) return '%';
  if (name.includes('dedicated memory') || name.includes('dynamic memory')) return 'MB';
  if (name.includes('vram')) return 'MB';
  if (name.includes('memory') || name.includes('used space') || name.includes('free space')) return 'GB';

  return '';
}

function inferUnitsFromSensor(sensor) {
  const name = String(sensor && sensor.name ? sensor.name : '').toLowerCase();
  if (!name) return '';

  if (name.includes('ip address') || name.includes('bios version') || name.includes('motherboard name') || name.includes('serial')) return '';
  if (name.includes('dimm') || name.includes('dram') || (name.includes('memory') && (name.includes('temp') || name.includes('temperature')))) return 'C';
  if (name.includes('vertical refresh rate') || name.includes('refresh rate')) return 'Hz';
  if ((name.includes('chipset') || name.includes('ccd') || (name.includes('motherboard') && !name.includes('name'))) && !name.includes('clock')) return 'C';
  if (name.includes('temp') || name.includes('diode') || name.includes('hotspot')) return 'C';
  if (name.includes('frame time') || name.includes('frametime')) return 'ms';
  if (name.includes('fps') || name.includes('framerate')) return 'FPS';
  if (name.includes('fan')) return 'RPM';
  if (name.includes('power')) return 'W';
  if (name.includes('volt') || name.includes('vdd') || name.includes('vid') || name.includes('vbat') || name.includes('+12 v') || name.includes('+5 v') || name.includes('+3.3 v')) return 'V';
  if (name.includes('current') || name.includes('curr')) return 'A';
  if (name.includes('connection speed') || name.includes('link speed')) return 'Mbps';
  if (name.includes('download') || name.includes('upload')) return 'KB/s';
  if (name.includes('throughput')) return 'Mbps';
  if (name.includes('multiplier')) return 'X';
  if (name.includes('utilization') || name.includes('usage') || name.includes('load') || name.includes('activity') || name.includes('duty')) return '%';
  if (name.includes('clock') || name.includes('freq') || name.includes('fsb')) return 'MHz';
  if (name.includes('dedicated memory') || name.includes('dynamic memory')) return 'MB';
  if (name.includes('vram')) return 'MB';
  if (name.includes('memory') || name.includes('used space') || name.includes('free space')) return 'GB';

  return '';
}

function buildGroupRenderSignature(sensors) {
  if (!sensors || !sensors.length) return 'empty';
  return sensors
    .map((sensor) => {
      const value = Number(sensor.value);
      const normalizedValue = Number.isFinite(value) ? value.toFixed(3) : String(sensor.value ?? '');
      const expanded = expandedGraphSensors.has(sensor.id) ? '1' : '0';
      let summarySignature = '';
      if (summaryModeEnabled) {
        const stats = sensorSessionStats[sensor.id];
        summarySignature = stats
          ? `${stats.min.toFixed(3)}|${(stats.sum / Math.max(1, stats.count)).toFixed(3)}|${stats.max.toFixed(3)}|${stats.count}`
          : 'none';
      }
      return `${sensor.id}|${getFinalDisplayLabel(sensor)}|${normalizedValue}|${sensor.units || ''}|${expanded}|summary:${summaryModeEnabled ? '1' : '0'}|${summarySignature}`;
    })
    .join('||');
}

function renderAllDynamicGroups(selected, options = {}) {
  const forceRender = !!options.force;
  if (document.hidden) {
    pendingVisibilityRefresh = true;
    return;
  }

  const now = Date.now();
  const effectiveMinRenderInterval = Math.max(250, Math.min(3000, Math.round(updateInterval * 0.75)));
  if (!forceRender && !forceNextUiRender && (now - lastUiRenderAt) < effectiveMinRenderInterval) {
    pendingVisibilityRefresh = true;
    return;
  }

  lastUiRenderAt = now;
  forceNextUiRender = false;
  pendingVisibilityRefresh = false;
  renderDynamicGroup('cpuSensorsDynamic', selected.cpu);
  renderDynamicGroup('gpuSensorsDynamic', selected.gpu);
  renderDynamicGroup('ramSensorsDynamic', selected.ram);
  renderDynamicGroup('psuSensorsDynamic', selected.psu);
  renderDynamicGroup('fansSensorsDynamic', selected.fans);
  renderDynamicGroup('networkSensorsDynamic', selected.network);
  renderDynamicGroup('drivesSensorsDynamic', selected.drives);
  renderDynamicGroup('externalSensorsDynamic', selected.other);
}

function renderSensorOptions(groupedSensors) {
  const container = document.getElementById('sensorOptions');
  if (!container) return;

  const hash = sensorCatalogHash(groupedSensors);
  if (hash === sensorCatalogSignature) return;

  sensorCatalogSignature = hash;
  ensureSensorDefaults(groupedSensors);
  ensureCategoryDefaults(groupedSensors);
  ensureSensorOrderDefaults(groupedSensors);
  saveSensorSelection();
  saveSensorCategorySelection();

  const html = SENSOR_GROUP_ORDER
    .map((group) => {
      const sensors = groupedSensors[group] || [];
      if (!sensors.length) return '';
      const groupEnabled = sensorCategorySelection[group] !== false;
      const items = sensors
        .map((sensor, index) => {
          const checked = sensorSelection[sensor.id] ? 'checked' : '';
          const disabled = groupEnabled ? '' : 'disabled';
          const label = escapeHtml(getFinalDisplayLabel(sensor));
          return `
            <div class="sensor-item-row" draggable="true" data-order-group="${group}" data-order-sensor-id="${sensor.id}">
              <span class="sensor-drag-handle" title="Drag to reorder" aria-hidden="true">⋮⋮</span>
              <label class="checkbox-label sensor-item-label"><input type="checkbox" data-sensor-id="${sensor.id}" ${checked} ${disabled}><span class="sensor-name">${label}</span></label>
              <div class="sensor-item-actions">
                <button type="button" class="sensor-order-btn sensor-rename-btn" data-rename-sensor-id="${sensor.id}" aria-label="Rename ${label}" title="Rename sensor">✎</button>
              </div>
            </div>
          `;
        })
        .join('');
      const categoryChecked = groupEnabled ? 'checked' : '';
      const groupLabel = SENSOR_GROUP_LABELS[group] || group;
      const iconClass = SENSOR_GROUP_ICONS[group] || 'bi-circle-fill';
      const isCollapsed = sensorCategoryCollapse[group] === true;
      return `
        <div class="sensor-category-block${groupEnabled ? '' : ' is-disabled'}${isCollapsed ? ' is-collapsed' : ''}">
          <div class="sensor-category-head-row">
            <label class="checkbox-label sensor-category-header">
              <input type="checkbox" data-sensor-group="${group}" ${categoryChecked}>
              <span class="sensor-category-title"><i class="bi ${iconClass} sensor-category-icon" aria-hidden="true"></i><strong>${escapeHtml(groupLabel)}</strong></span>
              <span class="sensor-category-count">${sensors.length}</span>
            </label>
            <button type="button" class="sensor-category-toggle" data-toggle-sensor-group="${group}" aria-expanded="${isCollapsed ? 'false' : 'true'}" aria-label="Toggle ${escapeHtml(groupLabel)} sensors">▾</button>
          </div>
          <div class="sensor-category-items${isCollapsed ? ' is-collapsed' : ''}">
            ${items}
          </div>
        </div>
      `;
    })
    .join('');

  container.innerHTML = html || '<div class="settings-note">No other sensors detected</div>';
}

function buildLiveSensorCatalogSignature(groupedSensors) {
  const keys = Object.keys(groupedSensors || {}).sort();
  const parts = [];
  for (const key of keys) {
    const sensors = (groupedSensors[key] || [])
      .map((sensor) => `${sensor.id}:${String(sensor.name || '').trim()}:${String(sensor.units || '').trim()}`)
      .sort();
    parts.push(`${key}:${sensors.join(',')}`);
  }
  return parts.join('|');
}

function rebuildCachedSensorCatalog(liveGroupedSensors) {
  const displayNamedGrouped = createDisplayNamedGroupedSensors(liveGroupedSensors);
  const orderedGrouped = applySensorOrderToGroupedSensors(displayNamedGrouped);
  renderSensorOptions(orderedGrouped);

  const nextCache = createEmptyGroupedBuckets();
  Object.keys(orderedGrouped || {}).forEach((group) => {
    nextCache[group] = (orderedGrouped[group] || []).map((sensor) => ({ ...sensor }));
  });
  cachedOrderedSensorCatalog = nextCache;
}

function buildSelectedSensorsFromCachedCatalog(liveGroupedSensors) {
  const selected = createEmptyGroupedBuckets();
  const liveById = new Map();

  Object.keys(liveGroupedSensors || {}).forEach((group) => {
    (liveGroupedSensors[group] || []).forEach((sensor) => {
      if (sensor && sensor.id) {
        liveById.set(sensor.id, sensor);
      }
    });
  });

  SENSOR_GROUP_ORDER.forEach((group) => {
    if (sensorCategorySelection[group] === false) {
      selected[group] = [];
      return;
    }

    const catalogSensors = cachedOrderedSensorCatalog[group] || [];
    selected[group] = catalogSensors
      .filter((sensor) => !!sensorSelection[sensor.id])
      .map((catalogSensor) => {
        const live = liveById.get(catalogSensor.id);
        if (!live) return null;
        return {
          ...live,
          name: catalogSensor.name || live.name,
          group: catalogSensor.group || live.group || group,
          units: live.units || catalogSensor.units || ''
        };
      })
      .filter(Boolean);
  });

  return selected;
}

function filterSelectedSensors(groupedSensors) {
  const filtered = createEmptyGroupedBuckets();
  Object.keys(groupedSensors || {}).forEach((group) => {
    if (!filtered[group]) filtered[group] = [];
    if (sensorCategorySelection[group] === false) {
      filtered[group] = [];
      return;
    }
    filtered[group] = (groupedSensors[group] || []).filter((sensor) => sensorSelection[sensor.id]);
  });
  return filtered;
}

function resolveBaseDisplayName(sensor) {
  const originalName = String(sensor && sensor.name ? sensor.name : '').trim();
  if (!originalName) return 'Sensor';

  const lower = originalName.toLowerCase();
  const group = String(sensor && sensor.group ? sensor.group : '').toLowerCase();
  const units = String(resolveDisplayUnits(sensor) || '').toLowerCase();

  if (lower.includes('cpu sensor')) return 'CPU Temp';
  if (lower === 'gpu sensor') {
    if (units === '%') return 'GPU Usage';
    if (units === '°c' || units === 'c') return 'GPU Temp';
    return 'GPU Sensor';
  }

  if (lower.includes('memory timing')) return originalName;

  if (lower === 'cpu' || lower === 'gpu') {
    const prefix = lower === 'cpu' ? 'CPU' : 'GPU';
    if (units === '%') return `${prefix} Usage`;
    if (units === '°c' || units === 'c') return `${prefix} Temperature`;
    if (units === 'w') return `${prefix} Power`;
    if (units === 'mhz' || units === 'ghz') return `${prefix} Frequency`;
    if (units === 'v') return `${prefix} Voltage`;
    return `${prefix} Sensor`;
  }

  if (group === 'fans' && lower === 'cpu') return 'CPU Fan';
  if (group === 'fans' && lower === 'gpu') return 'GPU Fan';
  if (group === 'psu' && lower === 'power supply') return units === 'w' ? 'PSU Power' : 'Power Supply';

  if (group === 'cpu' && lower === 'cpu package') {
    if (units === 'w') return 'CPU Power';
    if (units === '°c' || units === 'c') return 'CPU Package Temp';
  }

  if (group === 'gpu' && lower === 'gpu') {
    if (units === 'w') return 'GPU Power';
    if (units === 'rpm') return 'GPU Fan';
    if (units === '°c' || units === 'c') return 'GPU Temp';
  }

  if ((lower === 'memory speed' || lower === 'memory clock') && units === 'mhz') return 'Memory Clock';
  if (lower === 'memory speed' && units === 'ghz') return 'Memory Speed';

  return originalName;
}

function createDisplayNamedGroupedSensors(groupedSensors) {
  const output = createEmptyGroupedBuckets();

  Object.keys(groupedSensors || {}).forEach((group) => {
    const sourceList = Array.isArray(groupedSensors[group]) ? groupedSensors[group] : [];
    const seen = new Map();
    let gpuGenericIndex = 0;
    const driveLetters = group === 'drives'
      ? Array.from(new Set(sourceList
        .map((sensor) => String(sensor && sensor.name ? sensor.name : '').match(/\bDrive\s+([A-Z]):/i))
        .filter(Boolean)
        .map((match) => match[1].toUpperCase())))
      : [];

    output[group] = sourceList.map((sensor) => {
      const sourceName = String(sensor && sensor.name ? sensor.name : '');
      let normalizedSensor = sensor;

      if (group === 'drives') {
        const diskMatch = sourceName.match(/^Disk\s+(\d+)\s+(Activity|Read Speed|Write Speed)$/i);
        if (diskMatch) {
          const diskIndex = Math.max(0, Number(diskMatch[1]) - 1);
          const mappedLetter = driveLetters[diskIndex];
          if (mappedLetter) {
            normalizedSensor = {
              ...sensor,
              name: `Drive ${mappedLetter}: ${diskMatch[2]}`
            };
          }
        }
      }

      let baseName = resolveBaseDisplayName(normalizedSensor);
      const originalName = String(sensor && sensor.name ? sensor.name : '').trim();

      if (group === 'gpu' && baseName === 'GPU Sensor') {
        gpuGenericIndex += 1;
        baseName = gpuGenericIndex === 1 ? 'GPU Temp' : (gpuGenericIndex === 2 ? 'GPU Usage' : 'GPU Sensor');
      }

      const key = baseName.toLowerCase();
      const count = (seen.get(key) || 0) + 1;
      seen.set(key, count);

      let displayName = baseName;
      if (count > 1 && !originalName.toLowerCase().includes('memory timing')) {
        const unit = resolveDisplayUnits(sensor);
        displayName = unit ? `${baseName} (${unit} ${count})` : `${baseName} (${count})`;
      }

      return {
        ...normalizedSensor,
        name: getFinalDisplayLabel({ ...normalizedSensor, name: displayName })
      };
    });
  });

  return output;
}

function enrichGroupedSensorsWithRealtime(groupedSensors, externalData) {
  const base = createEmptyGroupedBuckets();
  Object.keys(groupedSensors || {}).forEach((group) => {
    base[group] = Array.isArray(groupedSensors[group]) ? [...groupedSensors[group]] : [];
  });

  if (!Array.isArray(base.ram)) base.ram = [];
  if (Array.isArray(base.cpu) && base.cpu.length) {
    const remainingCpuSensors = [];
    const movedMemorySensors = [];

    base.cpu.forEach((sensor) => {
      const name = String(sensor && sensor.name ? sensor.name : '').toLowerCase();
      if (name.includes('dram read bandwidth')) {
        movedMemorySensors.push({ ...sensor, group: 'ram', name: 'Memory Read' });
        return;
      }
      if (name.includes('dram write bandwidth')) {
        movedMemorySensors.push({ ...sensor, group: 'ram', name: 'Memory Write' });
        return;
      }
      remainingCpuSensors.push(sensor);
    });

    if (movedMemorySensors.length) {
      const existingIds = new Set(base.ram.map((sensor) => String(sensor && sensor.id ? sensor.id : '')));
      movedMemorySensors.forEach((sensor) => {
        const sensorId = String(sensor && sensor.id ? sensor.id : '');
        if (sensorId && existingIds.has(sensorId)) return;
        if (sensorId) existingIds.add(sensorId);
        base.ram.push(sensor);
      });
      base.cpu = remainingCpuSensors;
    }
  }

  if (!base.other) base.other = [];

  const allSensors = Object.values(base).flat();
  const findByName = (predicate) => allSensors.find((sensor) => predicate(String(sensor && sensor.name ? sensor.name : '').toLowerCase()));

  const existingFpsSensor = findByName((name) => /\bfps\b/.test(name));
  const existingFrameSensor = findByName((name) => name.includes('frame time') || name.includes('frametime'));

  const externalFps = Number(externalData && externalData.fps);
  const fallbackFps = Number(existingFpsSensor && existingFpsSensor.value);
  const resolvedFps = Number.isFinite(externalFps)
    ? externalFps
    : (Number.isFinite(fallbackFps) ? fallbackFps : 0);

  const externalFrameTime = Number(externalData && externalData.frameTime);
  const fallbackFrameTime = Number(existingFrameSensor && existingFrameSensor.value);
  let resolvedFrameTime = Number.isFinite(externalFrameTime) && externalFrameTime > 0
    ? externalFrameTime
    : (Number.isFinite(fallbackFrameTime) && fallbackFrameTime > 0 ? fallbackFrameTime : 0);

  if ((!resolvedFrameTime || resolvedFrameTime <= 0) && resolvedFps > 0) {
    resolvedFrameTime = 1000 / resolvedFps;
  }

  const frameCandidateGroups = Object.keys(base);
  const frameMatch = (() => {
    for (const group of frameCandidateGroups) {
      const idx = (base[group] || []).findIndex((sensor) => {
        const id = String(sensor && sensor.id ? sensor.id : '').toLowerCase();
        const name = String(sensor && sensor.name ? sensor.name : '').toLowerCase();
        return id.includes('frametime') || name.includes('frame time') || name.includes('frametime');
      });
      if (idx >= 0) return { group, idx };
    }
    return null;
  })();

  const frameSensorEntry = {
    id: 'rtss_frametime',
    name: 'RTSS Frame Time',
    value: Number.isFinite(resolvedFrameTime) ? resolvedFrameTime : 0,
    units: 'ms'
  };

  if (frameMatch) {
    const current = base[frameMatch.group][frameMatch.idx] || {};
    base[frameMatch.group][frameMatch.idx] = {
      ...current,
      ...frameSensorEntry,
      id: current.id || frameSensorEntry.id,
      name: current.name || frameSensorEntry.name
    };
  } else {
    const fpsIndexInOther = base.other.findIndex((sensor) => {
      const name = String(sensor && sensor.name ? sensor.name : '').toLowerCase();
      return /\bfps\b/.test(name);
    });
    const insertIndex = fpsIndexInOther >= 0 ? fpsIndexInOther + 1 : 0;
    base.other.splice(insertIndex, 0, frameSensorEntry);
  }

  return base;
}

function renderDynamicGroup(containerId, sensors) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const nextSignature = buildGroupRenderSignature(sensors);
  if (renderGroupSignatureCache[containerId] === nextSignature) return;
  renderGroupSignatureCache[containerId] = nextSignature;

  if (!sensors || !sensors.length) {
    container.innerHTML = '<div class="stat-empty">No selected sensors</div>';
    return;
  }

  container.innerHTML = sensors
    .map((sensor) => {
      const isExpanded = expandedGraphSensors.has(sensor.id);
      const encodedId = encodeURIComponent(sensor.id);
      const graphHtml = summaryModeEnabled ? renderSensorSummary(sensor) : (isExpanded ? renderSensorGraph(sensor) : '');
      const expandedClass = isExpanded ? ' is-expanded' : '';
      const clickableClass = summaryModeEnabled ? '' : ' stat-clickable';
      const roleAttr = summaryModeEnabled ? '' : ' role="button" tabindex="0"';
      const expandedAttr = summaryModeEnabled ? '' : ` aria-expanded="${isExpanded ? 'true' : 'false'}"`;
      const mainRowHtml = summaryModeEnabled
        ? `<div class="stat-main stat-main-summary"><span class="stat-label">${escapeHtml(getFinalDisplayLabel(sensor))}</span></div>`
        : `<div class="stat-main"><span class="stat-label">${escapeHtml(getFinalDisplayLabel(sensor))}</span><span class="stat-value">${escapeHtml(formatSensorValue(sensor))}</span></div>`;

      return `
        <div class="stat${clickableClass}${expandedClass}" data-sensor-id="${encodedId}"${roleAttr}${expandedAttr}>
          ${mainRowHtml}
          ${graphHtml}
        </div>
      `;
    })
    .join('');
}

function findSelectedSensorById(sensorId) {
  if (!sensorId) return null;
  const buckets = latestSelectedGroupedSensors || {};
  for (const group of SENSOR_GROUP_ORDER) {
    const list = Array.isArray(buckets[group]) ? buckets[group] : [];
    const found = list.find((sensor) => String(sensor && sensor.id ? sensor.id : '') === sensorId);
    if (found) return found;
  }
  return null;
}

function findCatalogSensorById(sensorId) {
  if (!sensorId) return null;
  const buckets = cachedOrderedSensorCatalog || {};
  for (const group of SENSOR_GROUP_ORDER) {
    const list = Array.isArray(buckets[group]) ? buckets[group] : [];
    const found = list.find((sensor) => String(sensor && sensor.id ? sensor.id : '') === sensorId);
    if (found) return found;
  }
  return null;
}

function applyCustomSensorNamesRefresh() {
  saveSensorCustomNames();
  invalidateRenderGroupCache();
  renderSensorOptions(cachedOrderedSensorCatalog);
  renderAllDynamicGroups(latestSelectedGroupedSensors || createEmptyGroupedBuckets(), { force: true });
}

function setCustomSensorName(sensorId, name) {
  const id = String(sensorId || '').trim();
  if (!id) return;
  const nextName = String(name || '').trim();
  if (!nextName) {
    delete sensorCustomNames[id];
  } else {
    sensorCustomNames[id] = nextName.slice(0, 80);
  }
  applyCustomSensorNamesRefresh();
}

function startInlineSensorRename(row, sensorId, fallbackName = '') {
  if (!row || !sensorId) return;
  if (row.classList.contains('is-renaming')) return;

  const nameEl = row.querySelector('.sensor-name');
  if (!nameEl) return;

  const id = String(sensorId).trim();
  const sensor = findSelectedSensorById(id) || findCatalogSensorById(id);
  const existingCustomName = String(sensorCustomNames[id] || '').trim();
  const currentDisplayName = sensor ? getFinalDisplayLabel(sensor) : (String(fallbackName || '').trim() || String(nameEl.textContent || '').trim() || 'Sensor');

  row.classList.add('is-renaming');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'sensor-rename-input';
  input.maxLength = 80;
  input.value = existingCustomName || currentDisplayName;
  input.setAttribute('aria-label', `Rename ${currentDisplayName}`);

  nameEl.style.display = 'none';
  nameEl.parentNode.insertBefore(input, nameEl.nextSibling);

  let finished = false;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    input.remove();
    nameEl.style.display = '';
    row.classList.remove('is-renaming');
  };

  const commit = () => {
    const nextName = String(input.value || '').trim();
    cleanup();
    setCustomSensorName(id, nextName);
  };

  const cancel = () => {
    cleanup();
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      commit();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  });

  input.addEventListener('blur', () => {
    commit();
  });

  input.focus();
  input.select();
}

function setupSensorGraphInteractions() {
  const container = document.getElementById('statsContainer');
  if (!container) return;

  const toggleGraph = (statElement) => {
    if (summaryModeEnabled) return;
    const encodedId = statElement.dataset.sensorId;
    if (!encodedId) return;

    const sensorId = decodeURIComponent(encodedId);
    if (expandedGraphSensors.has(sensorId)) {
      expandedGraphSensors.delete(sensorId);
    } else {
      expandedGraphSensors.add(sensorId);
    }

    saveExpandedGraphSensors();
    renderAllDynamicGroups(latestSelectedGroupedSensors || createEmptyGroupedBuckets(), { force: true });
  };

  container.addEventListener('click', (event) => {
    if (summaryModeEnabled) return;
    const statElement = event.target.closest('.stat-clickable');
    if (!statElement) return;
    event.preventDefault();
    event.stopPropagation();
    toggleGraph(statElement);
  });

  container.addEventListener('keydown', (event) => {
    if (summaryModeEnabled) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const statElement = event.target.closest('.stat-clickable');
    if (!statElement) return;
    event.preventDefault();
    event.stopPropagation();
    toggleGraph(statElement);
  });

  // Renaming is handled in Sensor Selection rows for reliability across runtimes.
}

// Theme and Settings
const CUSTOM_COLORS_KEY = 'customColors';
const BASE_COLOR_DEFAULTS = {
  font: '#e0e0e0',
  sensorLabel: '#b0b0b0',
  sensorValue: '#4d9fff',
  icon: '#4d9fff',
  graph: '#4d9fff',
  blockHeader: '#0066ff',
  outline: '#444444',
  background: '#1a1a1a'
};
const THEME_ACCENT_LIGHT_MAP = {
  blue: '#4d9fff',
  purple: '#c77dff',
  green: '#26d0b8',
  red: '#f07b7d',
  cyan: '#4dfdff',
  orange: '#ffb347'
};
const THEME_ACCENT_MAP = {
  blue: '#0066ff',
  purple: '#9d4edd',
  green: '#06a77d',
  red: '#e63946',
  cyan: '#00d9ff',
  orange: '#f77f00'
};

function getThemeDefaults(themeName) {
  const key = String(themeName || 'blue').toLowerCase();
  const accentLight = THEME_ACCENT_LIGHT_MAP[key] || BASE_COLOR_DEFAULTS.sensorValue;
  const accent = THEME_ACCENT_MAP[key] || BASE_COLOR_DEFAULTS.blockHeader;
  return {
    ...BASE_COLOR_DEFAULTS,
    sensorValue: accentLight,
    icon: accentLight,
    graph: accentLight,
    blockHeader: accent
  };
}

function normalizeHexColor(value, fallback) {
  const text = String(value || '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  if (/^#[0-9a-f]{3}$/.test(text)) {
    return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`;
  }
  return fallback;
}

function adjustHexColor(hex, delta) {
  const normalized = normalizeHexColor(hex, '#000000');
  const raw = normalized.slice(1);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const r = clamp(parseInt(raw.slice(0, 2), 16) + delta);
  const g = clamp(parseInt(raw.slice(2, 4), 16) + delta);
  const b = clamp(parseInt(raw.slice(4, 6), 16) + delta);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const CustomColorManager = {
  getColors(themeName) {
    const defaults = getThemeDefaults(themeName || localStorage.getItem('theme') || 'blue');
    try {
      const raw = localStorage.getItem(CUSTOM_COLORS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return {
        font: normalizeHexColor(parsed.font, defaults.font),
        sensorLabel: normalizeHexColor(parsed.sensorLabel, defaults.sensorLabel),
        sensorValue: normalizeHexColor(parsed.sensorValue, defaults.sensorValue),
        icon: normalizeHexColor(parsed.icon, defaults.icon),
        graph: normalizeHexColor(parsed.graph, defaults.graph),
        blockHeader: normalizeHexColor(parsed.blockHeader, defaults.blockHeader),
        outline: normalizeHexColor(parsed.outline, defaults.outline),
        background: normalizeHexColor(parsed.background, defaults.background)
      };
    } catch (error) {
      return { ...defaults };
    }
  },
  saveColors(colors) {
    const defaults = getThemeDefaults(localStorage.getItem('theme') || 'blue');
    const normalized = {
      font: normalizeHexColor(colors && colors.font, defaults.font),
      sensorLabel: normalizeHexColor(colors && colors.sensorLabel, defaults.sensorLabel),
      sensorValue: normalizeHexColor(colors && colors.sensorValue, defaults.sensorValue),
      icon: normalizeHexColor(colors && colors.icon, defaults.icon),
      graph: normalizeHexColor(colors && colors.graph, defaults.graph),
      blockHeader: normalizeHexColor(colors && colors.blockHeader, defaults.blockHeader),
      outline: normalizeHexColor(colors && colors.outline, defaults.outline),
      background: normalizeHexColor(colors && colors.background, defaults.background)
    };
    localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(normalized));
  },
  applyColors(colors) {
    const defaults = getThemeDefaults(localStorage.getItem('theme') || 'blue');
    const normalized = {
      font: normalizeHexColor(colors && colors.font, defaults.font),
      sensorLabel: normalizeHexColor(colors && colors.sensorLabel, defaults.sensorLabel),
      sensorValue: normalizeHexColor(colors && colors.sensorValue, defaults.sensorValue),
      icon: normalizeHexColor(colors && colors.icon, defaults.icon),
      graph: normalizeHexColor(colors && colors.graph, defaults.graph),
      blockHeader: normalizeHexColor(colors && colors.blockHeader, defaults.blockHeader),
      outline: normalizeHexColor(colors && colors.outline, defaults.outline),
      background: normalizeHexColor(colors && colors.background, defaults.background)
    };

    document.body.style.setProperty('--text-primary', normalized.font);
    document.body.style.setProperty('--text-secondary', normalized.font);
    document.body.style.setProperty('--sensor-label-color', normalized.sensorLabel);
    document.body.style.setProperty('--sensor-value-color', normalized.sensorValue);
    document.body.style.setProperty('--icon-color', normalized.icon);
    document.body.style.setProperty('--graph-color', normalized.graph);
    document.body.style.setProperty('--block-header-color', normalized.blockHeader);
    document.body.style.setProperty('--border-color', normalized.outline);
    document.body.style.setProperty('--bg-primary', normalized.background);
    document.body.style.setProperty('--bg-secondary', adjustHexColor(normalized.background, 19));
    document.body.style.setProperty('--bg-tertiary', adjustHexColor(normalized.background, 32));
  },
  resetToThemeDefaults(themeName) {
    const defaults = getThemeDefaults(themeName || localStorage.getItem('theme') || 'blue');
    this.saveColors(defaults);
    this.applyColors(defaults);
    return defaults;
  }
};

const ThemeManager = {
  setTheme(theme) {
    const previousTheme = this.getTheme();
    const previousDefaults = getThemeDefaults(previousTheme);
    const nextDefaults = getThemeDefaults(theme);
    const currentColors = CustomColorManager.getColors(previousTheme);
    const migratedColors = { ...currentColors };

    ['sensorValue', 'icon', 'graph', 'blockHeader'].forEach((key) => {
      if (normalizeHexColor(currentColors[key], previousDefaults[key]) === normalizeHexColor(previousDefaults[key], previousDefaults[key])) {
        migratedColors[key] = nextDefaults[key];
      }
    });

    document.body.classList.remove('theme-blue', 'theme-purple', 'theme-green', 'theme-red', 'theme-cyan', 'theme-orange');
    document.body.classList.add(`theme-${theme}`);
    localStorage.setItem('theme', theme);
    CustomColorManager.saveColors(migratedColors);
    CustomColorManager.applyColors(migratedColors);
  },
  getTheme() {
    return localStorage.getItem('theme') || 'blue';
  }
};

const SettingsManager = {
  init() {
    sensorCustomNames = loadSensorCustomNames();
    setupSettingsAccordion();

    const customFontColorInput = document.getElementById('customFontColor');
    const customSensorNameColorInput = document.getElementById('customSensorNameColor');
    const customSensorValueColorInput = document.getElementById('customSensorValueColor');
    const customIconColorInput = document.getElementById('customIconColor');
    const customGraphColorInput = document.getElementById('customGraphColor');
    const customBlockHeaderColorInput = document.getElementById('customBlockHeaderColor');
    const customOutlineColorInput = document.getElementById('customOutlineColor');
    const customBackgroundColorInput = document.getElementById('customBackgroundColor');
    const resetThemeColorsBtn = document.getElementById('resetThemeColorsBtn');
    let customColors = CustomColorManager.getColors();
    CustomColorManager.applyColors(customColors);

    const syncCustomInputsFromColors = (colors) => {
      if (!customFontColorInput || !customSensorNameColorInput || !customSensorValueColorInput || !customIconColorInput || !customGraphColorInput || !customBlockHeaderColorInput || !customOutlineColorInput || !customBackgroundColorInput) {
        return;
      }
      customFontColorInput.value = colors.font;
      customSensorNameColorInput.value = colors.sensorLabel;
      customSensorValueColorInput.value = colors.sensorValue;
      customIconColorInput.value = colors.icon;
      customGraphColorInput.value = colors.graph;
      customBlockHeaderColorInput.value = colors.blockHeader;
      customOutlineColorInput.value = colors.outline;
      customBackgroundColorInput.value = colors.background;
    };

    const themeButtons = document.querySelectorAll('.theme-btn');
    themeButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        themeButtons.forEach((b) => b.classList.remove('active'));
        e.target.classList.add('active');
        ThemeManager.setTheme(e.target.dataset.theme);
        customColors = CustomColorManager.getColors();
        syncCustomInputsFromColors(customColors);
      });
    });

    if (customFontColorInput && customSensorNameColorInput && customSensorValueColorInput && customIconColorInput && customGraphColorInput && customBlockHeaderColorInput && customOutlineColorInput && customBackgroundColorInput) {
      syncCustomInputsFromColors(customColors);

      const syncCustomColors = () => {
        customColors = {
          font: normalizeHexColor(customFontColorInput.value, BASE_COLOR_DEFAULTS.font),
          sensorLabel: normalizeHexColor(customSensorNameColorInput.value, BASE_COLOR_DEFAULTS.sensorLabel),
          sensorValue: normalizeHexColor(customSensorValueColorInput.value, BASE_COLOR_DEFAULTS.sensorValue),
          icon: normalizeHexColor(customIconColorInput.value, BASE_COLOR_DEFAULTS.icon),
          graph: normalizeHexColor(customGraphColorInput.value, BASE_COLOR_DEFAULTS.graph),
          blockHeader: normalizeHexColor(customBlockHeaderColorInput.value, BASE_COLOR_DEFAULTS.blockHeader),
          outline: normalizeHexColor(customOutlineColorInput.value, BASE_COLOR_DEFAULTS.outline),
          background: normalizeHexColor(customBackgroundColorInput.value, BASE_COLOR_DEFAULTS.background)
        };
        CustomColorManager.saveColors(customColors);
        CustomColorManager.applyColors(customColors);
      };

      customFontColorInput.addEventListener('input', syncCustomColors);
      customSensorNameColorInput.addEventListener('input', syncCustomColors);
      customSensorValueColorInput.addEventListener('input', syncCustomColors);
      customIconColorInput.addEventListener('input', syncCustomColors);
      customGraphColorInput.addEventListener('input', syncCustomColors);
      customBlockHeaderColorInput.addEventListener('input', syncCustomColors);
      customOutlineColorInput.addEventListener('input', syncCustomColors);
      customBackgroundColorInput.addEventListener('input', syncCustomColors);

      if (resetThemeColorsBtn) {
        resetThemeColorsBtn.addEventListener('click', () => {
          const defaults = CustomColorManager.resetToThemeDefaults(ThemeManager.getTheme());
          syncCustomInputsFromColors(defaults);
        });
      }
    }

    // Refresh rate slider
    const refreshSlider = document.getElementById('refreshRate');
    const refreshValue = document.getElementById('refreshValue');
    refreshSlider.addEventListener('input', (e) => {
      updateInterval = clampRefreshInterval(e.target.value);
      if (String(refreshSlider.value) !== String(updateInterval)) {
        refreshSlider.value = String(updateInterval);
      }
      refreshValue.textContent = updateInterval;
      localStorage.setItem('refreshRate', updateInterval);
      restartUpdateTimer();
    });

    // Visibility checkboxes
    const visibilityCheckboxes = {
      showCpu: 'cpuGroup',
      showGpu: 'gpuGroup',
      showRam: 'ramGroup',
      showPsu: 'psuGroup',
      showFans: 'fansGroup',
      showNetwork: 'networkGroup',
      showDrives: 'drivesGroup',
      showExternal: 'externalGroup'
    };
    
    // Detection mode dropdown
    const detectionSelect = document.getElementById('detectionMode');
    if (detectionSelect) {
      const savedMode = localStorage.getItem('detectionMode') || 'msi';
      const normalizedMode = savedMode === 'msi' ? 'msi' : 'msi';
      detectionSelect.value = 'msi';
      if (savedMode !== normalizedMode) {
        localStorage.setItem('detectionMode', normalizedMode);
      }
      detectionSelect.addEventListener('change', (e) => {
        localStorage.setItem('detectionMode', 'msi');
        if (e.target.value !== 'msi') {
          e.target.value = 'msi';
        }
      });
    }

    const openSetupGuideBtn = document.getElementById('openSetupGuideBtn');
    if (openSetupGuideBtn) {
      openSetupGuideBtn.addEventListener('click', () => {
        openSetupGuideModal();
      });
    }

    const resetSensorNamesBtn = document.getElementById('resetSensorNamesBtn');
    if (resetSensorNamesBtn) {
      resetSensorNamesBtn.addEventListener('click', () => {
        sensorCustomNames = {};
        applyCustomSensorNamesRefresh();
      });
    }

    const exportSettingsBtn = document.getElementById('exportSettingsBtn');
    const importSettingsBtn = document.getElementById('importSettingsBtn');

    const SETTINGS_EXPORT_KEYS = [
      SENSOR_ORDER_KEY,
      SENSOR_SELECTION_KEY,
      SENSOR_CATEGORY_SELECTION_KEY,
      SENSOR_CUSTOM_NAMES_KEY,
      CUSTOM_COLORS_KEY,
      VIEW_MODE_KEY,
      'theme',
      FONT_SIZE_KEY,
      FONT_FAMILY_KEY,
      VALUE_FONT_MONOSPACE_KEY,
      SUMMARY_MODE_KEY,
      'refreshRate'
    ];

    if (exportSettingsBtn) {
      exportSettingsBtn.addEventListener('click', () => {
        try {
          const payload = {};
          SETTINGS_EXPORT_KEYS.forEach((k) => {
            try {
              payload[k] = localStorage.getItem(k);
            } catch (e) {
              payload[k] = null;
            }
          });
          // include any in-memory state fallback
          try {
            payload[SENSOR_ORDER_KEY] = JSON.stringify(sensorOrderByGroup || {});
          } catch (e) {}

          const blob = new Blob([JSON.stringify({ exportedAt: Date.now(), data: payload }, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `SiR_Settings_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        } catch (error) {
          console.error('Export failed', error);
          alert('Failed to export settings: ' + (error && error.message ? error.message : String(error)));
        }
      });
    }

    if (importSettingsBtn) {
      importSettingsBtn.addEventListener('click', () => {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json,application/json';
        fileInput.addEventListener('change', (ev) => {
          const file = ev.target.files && ev.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const parsed = JSON.parse(String(reader.result || '{}'));
              const data = parsed && parsed.data ? parsed.data : parsed;

              // prepare a summary for the modal
              const summary = {};
              try {
                if (data.theme) summary.theme = String(data.theme).replace(/^\"|\"$/g, '');
                if (data[VIEW_MODE_KEY]) summary.viewMode = String(data[VIEW_MODE_KEY]).replace(/^\"|\"$/g, '');
                if (data[FONT_SIZE_KEY]) summary.fontSize = String(data[FONT_SIZE_KEY]).replace(/^\"|\"$/g, '');
              } catch (e) {}

              // store parsed into a temporary location on the modal element
              const modal = document.getElementById('importSettingsModal');
              if (modal) {
                modal.dataset.parsed = JSON.stringify(data || {});
                const body = modal.querySelector('.import-body');
                if (body) {
                  // No preview required — show a concise confirmation message
                  body.innerHTML = `<div class="setup-guide-highlight">Settings file loaded. Choose an action below to apply the imported settings.</div>`;
                }
                setImportSettingsModalVisible(true);
              } else {
                // fallback: apply immediately and prompt reload
                Object.keys(data || {}).forEach((k) => {
                  try {
                    const v = data[k];
                    if (v === null || v === undefined) {
                      localStorage.removeItem(k);
                    } else {
                      localStorage.setItem(k, String(v));
                    }
                  } catch (e) {}
                });
                if (confirm('Settings imported. Reload the app now to apply them?')) {
                  location.reload();
                }
              }
            } catch (err) {
              console.error('Import failed', err);
              alert('Failed to import settings: ' + (err && err.message ? err.message : String(err)));
            }
          };
          reader.readAsText(file);
        });
        fileInput.click();
      });
    }

    // Font size selector
    const fontSizeSelect = document.getElementById('fontSizeSelect');
    if (fontSizeSelect) {
      const savedFontSize = localStorage.getItem(FONT_SIZE_KEY) || 'medium';
      fontSizeSelect.value = savedFontSize;
      applyFontSize(savedFontSize);
      fontSizeSelect.addEventListener('change', (e) => {
        applyFontSize(e.target.value);
      });
    }

    const fontFamilySelect = document.getElementById('fontFamilySelect');
    if (fontFamilySelect) {
      const savedFontFamily = localStorage.getItem(FONT_FAMILY_KEY) || 'segoe';
      fontFamilySelect.value = Object.prototype.hasOwnProperty.call(FONT_FAMILY_MAP, savedFontFamily) ? savedFontFamily : 'segoe';
      applyFontFamily(fontFamilySelect.value);
      fontFamilySelect.addEventListener('change', (e) => {
        applyFontFamily(e.target.value);
      });
    }

    const fontBoldToggle = document.getElementById('fontBoldToggle');
    if (fontBoldToggle) {
      const savedBold = localStorage.getItem(FONT_BOLD_KEY);
      const isBold = savedBold === 'true';
      fontBoldToggle.checked = isBold;
      applyFontBold(isBold);
      fontBoldToggle.addEventListener('change', (e) => {
        applyFontBold(!!e.target.checked);
      });
    }

    const valueFontMonospaceToggle = document.getElementById('valueFontMonospaceToggle');
    if (valueFontMonospaceToggle) {
      const isMonospace = localStorage.getItem(VALUE_FONT_MONOSPACE_KEY) === 'true';
      valueFontMonospaceToggle.checked = isMonospace;
      applyValueFontMonospace(isMonospace);
      valueFontMonospaceToggle.addEventListener('change', (e) => {
        applyValueFontMonospace(!!e.target.checked);
      });
    }

    const temperatureUnitSelect = document.getElementById('temperatureUnitSelect');
    if (temperatureUnitSelect) {
      const savedTemperatureUnit = normalizeTemperatureUnit(localStorage.getItem(TEMPERATURE_UNIT_KEY));
      temperatureUnitSelect.value = savedTemperatureUnit;
      applyTemperatureUnit(savedTemperatureUnit, { persist: false });
      temperatureUnitSelect.addEventListener('change', (e) => {
        applyTemperatureUnit(e.target.value);
      });
    }

    // Shared memory provider toggles
    const providerSelection = loadProviderSelection();
    const providerCheckboxes = {
      providerRTSS: 'rtss',
      providerAIDA64: 'aida64',
      providerHWiNFO: 'hwinfo'
    };

    Object.entries(providerCheckboxes).forEach(([elementId, providerKey]) => {
      const checkbox = document.getElementById(elementId);
      if (!checkbox) return;
      checkbox.checked = providerSelection[providerKey] !== false;
      checkbox.addEventListener('change', () => {
        const nextSelection = loadProviderSelection();
        nextSelection[providerKey] = !!checkbox.checked;
        saveProviderSelection(nextSelection);
        updateStats();
      });
    });

    Object.entries(visibilityCheckboxes).forEach(([checkId, groupId]) => {
      const checkbox = document.getElementById(checkId);
      const group = document.getElementById(groupId);
      
      const saved = localStorage.getItem(checkId);
      if (saved !== null) {
        checkbox.checked = saved === 'true';
        group.style.display = checkbox.checked ? 'block' : 'none';
      }

      checkbox.addEventListener('change', (e) => {
        group.style.display = e.target.checked ? 'block' : 'none';
        localStorage.setItem(checkId, e.target.checked);
      });
    });

    const monitoringButton = document.getElementById('monitoringModeBtn');
    if (monitoringButton) {
      const savedMonitoringMode = localStorage.getItem(MONITORING_MODE_KEY) === 'true';
      applyMonitoringMode(savedMonitoringMode);

      monitoringButton.addEventListener('click', () => {
        const nextState = !document.body.classList.contains('monitoring-mode');
        applyMonitoringMode(nextState);
      });
    }

    const summaryButton = document.getElementById('summaryModeBtn');
    if (summaryButton) {
      const storedSummaryMode = localStorage.getItem(SUMMARY_MODE_KEY);
      // Default to OFF for new users (stored === null) to avoid starting in summary mode
      const savedSummaryMode = storedSummaryMode === null ? false : storedSummaryMode === 'true';
      applySummaryMode(savedSummaryMode);

      summaryButton.addEventListener('click', () => {
        applySummaryMode(!summaryModeEnabled);
      });
    }

    const viewModeButton = document.getElementById('viewModeBtn');
    const savedViewMode = normalizeViewMode(localStorage.getItem(VIEW_MODE_KEY) || 'standard');
    applyViewMode(savedViewMode, { persist: false });

    if (viewModeButton) {
      viewModeButton.addEventListener('click', () => {
        const currentMode = normalizeViewMode(localStorage.getItem(VIEW_MODE_KEY) || 'standard');
        const nextMode = getNextViewMode(currentMode);
        applyViewMode(nextMode);
      });
    }

    // Low Overhead Mode UI removed; no bindings required here.

    const webEnabled = document.getElementById('webMonitorEnabled');
    const webAutoStart = document.getElementById('webMonitorAutoStart');
    const webHost = document.getElementById('webMonitorHost');
    const webPort = document.getElementById('webMonitorPort');
    const webApplyBtn = document.getElementById('webMonitorApplyBtn');
    const webOpenBtn = document.getElementById('webMonitorOpenBtn');

    const applyWebSettings = async () => {
      const nextSettings = normalizeWebMonitorSettings({
        enabled: !!(webEnabled && webEnabled.checked),
        autoStart: !!(webAutoStart && webAutoStart.checked),
        host: webHost ? webHost.value : DEFAULT_WEB_MONITOR_SETTINGS.host,
        port: webPort ? Number(webPort.value) : DEFAULT_WEB_MONITOR_SETTINGS.port
      });

      if (webHost) webHost.value = nextSettings.host;
      if (webPort) webPort.value = String(nextSettings.port);

      saveWebMonitorSettings(nextSettings);
      if (nextSettings.enabled) {
        await startWebMonitorServer(nextSettings);
      } else {
        await stopWebMonitorServer();
      }
    };

    if (webApplyBtn) {
      webApplyBtn.addEventListener('click', () => {
        applyWebSettings();
      });
    }

    if (webOpenBtn) {
      webOpenBtn.addEventListener('click', () => {
        const targetUrl = webMonitorRuntime.urls[0];
        if (!targetUrl) return;
        shell.openExternal(targetUrl);
      });
    }

    // Web Monitor toggle button in header
    const webMonitorToggleBtn = document.getElementById('webMonitorToggleBtn');
    if (webMonitorToggleBtn) {
      webMonitorToggleBtn.addEventListener('click', () => {
        const webEnabledCheckbox = document.getElementById('webMonitorEnabled');
        if (webEnabledCheckbox) {
          // Toggle the checkbox state
          webEnabledCheckbox.checked = !webEnabledCheckbox.checked;
        }
        // Then apply the settings (which will read the checkbox state)
        applyWebSettings();
      });
    }

    const savedWebSettings = normalizeWebMonitorSettings(loadWebMonitorSettings());
    if (webEnabled) webEnabled.checked = savedWebSettings.enabled;
    if (webAutoStart) webAutoStart.checked = savedWebSettings.autoStart;
    if (webHost) webHost.value = savedWebSettings.host;
    if (webPort) webPort.value = String(savedWebSettings.port);
    refreshWebMonitorStatusUi();

    if (savedWebSettings.enabled && savedWebSettings.autoStart) {
      startWebMonitorServer(savedWebSettings);
    }

    const appBehaviorControls = {
      launchAtStartup: document.getElementById('launchAtStartup'),
      startMinimized: document.getElementById('startMinimized'),
      minimizeToTray: document.getElementById('minimizeToTray'),
      closeToTray: document.getElementById('closeToTray')
    };

    const discordPresenceSelect = document.getElementById('discordPresenceSelect');
    const discordPresenceStatus = document.getElementById('discordPresenceStatus');

    const applyAppBehaviorToUi = (settings) => {
      const normalized = normalizeAppBehaviorSettings(settings);
      Object.entries(appBehaviorControls).forEach(([key, element]) => {
        if (!element) return;
        element.checked = !!normalized[key];
      });
      if (discordPresenceSelect) {
        discordPresenceSelect.value = normalized.enableDiscordRichPresence ? 'enabled' : 'disabled';
      }
    };

    const updateDiscordPresenceStatusUi = ({ enabled, connected }) => {
      let statusText = 'Unknown';
      let stateClass = 'disabled';

      if (!enabled) {
        statusText = 'Disabled';
        stateClass = 'disabled';
      } else if (connected === true) {
        statusText = 'Connected';
        stateClass = 'connected';
      } else if (connected === false) {
        statusText = 'Disconnected';
        stateClass = 'disconnected';
      } else {
        statusText = 'Connecting…';
        stateClass = 'disabled';
      }

      // Update sidebar status pill
      if (discordPresenceStatus) {
        discordPresenceStatus.className = `discord-status-pill ${stateClass}`;
        discordPresenceStatus.innerHTML = `<span class="discord-status-dot"></span><span class="status-text">${statusText}</span>`;
      }

      // Update header toggle button
      const toggleBtn = document.getElementById('discordPresenceToggleBtn');
      if (toggleBtn) {
        toggleBtn.classList.remove('disabled', 'connected');
        if (!enabled) {
          toggleBtn.classList.add('disabled');
          toggleBtn.querySelector('.discord-toggle-text').textContent = 'Discord: Off';
        } else if (connected === true) {
          toggleBtn.classList.add('enabled', 'connected');
          toggleBtn.querySelector('.discord-toggle-text').textContent = 'Discord: On';
        } else {
          toggleBtn.classList.add('enabled');
          toggleBtn.querySelector('.discord-toggle-text').textContent = 'Discord: On';
        }
      }
    };

    const readAppBehaviorFromUi = () => {
      return normalizeAppBehaviorSettings({
        launchAtStartup: !!appBehaviorControls.launchAtStartup?.checked,
        startMinimized: !!appBehaviorControls.startMinimized?.checked,
        minimizeToTray: !!appBehaviorControls.minimizeToTray?.checked,
        closeToTray: !!appBehaviorControls.closeToTray?.checked
      ,
        enableDiscordRichPresence: discordPresenceSelect ? (discordPresenceSelect.value === 'enabled') : true
      });
    };

    const appBehaviorKeys = Object.keys(appBehaviorControls);
    appBehaviorKeys.forEach((key) => {
      const element = appBehaviorControls[key];
      if (!element) return;
      element.addEventListener('change', async () => {
        const saved = await setAppBehaviorSettings(readAppBehaviorFromUi());
        applyAppBehaviorToUi(saved);
      });
    });

    if (discordPresenceSelect) {
      discordPresenceSelect.addEventListener('change', async () => {
        const saved = await setAppBehaviorSettings(readAppBehaviorFromUi());
        applyAppBehaviorToUi(saved);
        updateDiscordPresenceStatusUi({ enabled: saved.enableDiscordRichPresence, connected: false });
      });
    }

    // Discord toggle button in header
    const discordPresenceToggleBtn = document.getElementById('discordPresenceToggleBtn');
    if (discordPresenceToggleBtn) {
      discordPresenceToggleBtn.addEventListener('click', async () => {
        const currentEnabled = discordPresenceSelect ? (discordPresenceSelect.value === 'enabled') : true;
        const newEnabled = !currentEnabled;
        if (discordPresenceSelect) {
          discordPresenceSelect.value = newEnabled ? 'enabled' : 'disabled';
        }
        const saved = await setAppBehaviorSettings(readAppBehaviorFromUi());
        applyAppBehaviorToUi(saved);
        updateDiscordPresenceStatusUi({ enabled: saved.enableDiscordRichPresence, connected: false });
      });
    }

    ipcRenderer.on('discord-presence:status', (_event, payload) => {
      updateDiscordPresenceStatusUi(payload);
    });

    getAppBehaviorSettings().then((settings) => {
      applyAppBehaviorToUi(settings);
      updateDiscordPresenceStatusUi({ enabled: settings.enableDiscordRichPresence, connected: settings.enableDiscordRichPresence ? null : false });
    });

    const checkForUpdatesBtn = document.getElementById('checkForUpdatesBtn');
    const openLatestReleaseBtn = document.getElementById('openLatestReleaseBtn');
    const updateCheckStatus = document.getElementById('updateCheckStatus');
    const updateAvailableModal = document.getElementById('updateAvailableModal');
    const closeUpdateModalBtn = document.getElementById('closeUpdateModalBtn');
    const updateModalLaterBtn = document.getElementById('updateModalLaterBtn');
    const updateModalDownloadBtn = document.getElementById('updateModalDownloadBtn');
    const updateModalInstallBtn = document.getElementById('updateModalInstallBtn');
    const updateModalMessage = document.getElementById('updateModalMessage');
    const updateModalProgress = document.getElementById('updateModalProgress');
    let latestReleaseUrl = DEFAULT_LATEST_RELEASE_URL;
    let inAppDownloadAvailable = true;

    const setUpdateModalVisible = (visible) => {
      if (!updateAvailableModal) return;
      updateAvailableModal.classList.toggle('is-hidden', !visible);
    };

    const setUpdateModalMessage = (message) => {
      if (updateModalMessage) {
        updateModalMessage.textContent = message;
      }
    };

    const setUpdateModalProgress = (message) => {
      if (updateModalProgress) {
        updateModalProgress.textContent = message || '';
      }
    };

    const setUpdateStatus = (message) => {
      if (updateCheckStatus) {
        updateCheckStatus.textContent = message;
      }
    };

    const toggleOpenLatestButton = (enabled) => {
      if (!openLatestReleaseBtn) return;
      openLatestReleaseBtn.disabled = !enabled;
    };

    toggleOpenLatestButton(/^https?:\/\//i.test(latestReleaseUrl));

    const toggleInstallNowButton = (enabled) => {
      if (updateModalInstallBtn) {
        updateModalInstallBtn.hidden = !enabled;
        updateModalInstallBtn.disabled = !enabled;
      }
    };

    if (updateAvailableModal) {
      closeUpdateModalBtn?.addEventListener('click', () => setUpdateModalVisible(false));
      updateModalLaterBtn?.addEventListener('click', () => setUpdateModalVisible(false));
      updateAvailableModal.addEventListener('click', (event) => {
        if (event.target === updateAvailableModal) {
          setUpdateModalVisible(false);
        }
      });
    }

    if (ipcRenderer && typeof ipcRenderer.on === 'function') {
      ipcRenderer.on('app-update:status', (_event, payload) => {
        const state = String(payload?.state || '').trim();

        if (state === 'checking') {
          setUpdateStatus('Checking for updates...');
          toggleInstallNowButton(false);
          return;
        }

        if (state === 'available') {
          const latestVersion = String(payload?.latestVersion || '').trim();
          const releaseTitle = String(payload?.releaseTitle || '').trim();
          latestReleaseUrl = String(payload?.releaseUrl || latestReleaseUrl || '').trim();
          // Use the provided release title when available, otherwise fall back to the
          // version/tag. Remove a trailing "_Release" suffix if present.
          let displayTitle = String(releaseTitle || latestVersion || '').trim();
          displayTitle = displayTitle.replace(/_Release$/i, '');
          const availableMessage = displayTitle
            ? `Update available: ${displayTitle}.`
            : 'Update available.';
          setUpdateStatus(`${availableMessage} Open the prompt to download inside the app.`);
          setUpdateModalMessage(`${availableMessage} Do you want to download it now?`);
          setUpdateModalProgress('');
          // Show release notes if provided
          try {
            const notesEl = document.getElementById('updateModalNotes');
            const notesHtml = String(payload?.releaseNotes || '').trim();
            if (notesEl) {
              if (notesHtml) {
                notesEl.hidden = false;
                notesEl.setAttribute('aria-hidden', 'false');
                notesEl.innerHTML = notesHtml;
              } else {
                notesEl.hidden = true;
                notesEl.setAttribute('aria-hidden', 'true');
                notesEl.innerHTML = '';
              }
            }
          } catch (e) {
            // ignore errors rendering notes
          }
          if (updateModalDownloadBtn) {
            updateModalDownloadBtn.disabled = !inAppDownloadAvailable;
            updateModalDownloadBtn.textContent = inAppDownloadAvailable ? 'Download Update' : 'In-App Download Unavailable';
          }
          toggleInstallNowButton(false);
          setUpdateModalVisible(true);
          toggleOpenLatestButton(/^https?:\/\//i.test(latestReleaseUrl));
          return;
        }

        if (state === 'downloading') {
          const percent = Number(payload?.percent || 0);
          const progressText = Number.isFinite(percent) && percent > 0
            ? `Downloading update... ${percent.toFixed(1)}%`
            : 'Downloading update...';
          if (Number.isFinite(percent) && percent > 0) {
            setUpdateStatus(progressText);
          } else {
            setUpdateStatus(progressText);
          }
          setUpdateModalProgress(progressText);
          if (updateModalDownloadBtn) {
            updateModalDownloadBtn.disabled = true;
            updateModalDownloadBtn.textContent = 'Downloading...';
          }
          toggleInstallNowButton(false);
          try { const notesEl = document.getElementById('updateModalNotes'); if (notesEl) { notesEl.hidden = true; notesEl.setAttribute('aria-hidden','true'); notesEl.innerHTML = ''; } } catch (e) {}
          return;
        }

        if (state === 'downloaded') {
          const latestVersion = String(payload?.latestVersion || '').trim();
          const downloadedText = latestVersion
            ? `Update ${latestVersion} downloaded.`
            : 'Update downloaded.';
          const installPromptText = 'Download complete. Press "Restart to Install" to install the new version.';
          setUpdateStatus(`${downloadedText} ${installPromptText}`);
          setUpdateModalMessage(`${downloadedText} ${installPromptText}`);
          setUpdateModalProgress(installPromptText);
          if (updateModalDownloadBtn) {
            updateModalDownloadBtn.disabled = true;
            updateModalDownloadBtn.textContent = 'Downloaded';
          }
          toggleInstallNowButton(true);
          setUpdateModalVisible(true);
          try { const notesEl = document.getElementById('updateModalNotes'); if (notesEl) { notesEl.hidden = true; notesEl.setAttribute('aria-hidden','true'); notesEl.innerHTML = ''; } } catch (e) {}
          return;
        }

        if (state === 'not-available') {
          setUpdateStatus('No Updates Found');
          toggleInstallNowButton(false);
          try { const notesEl = document.getElementById('updateModalNotes'); if (notesEl) { notesEl.hidden = true; notesEl.setAttribute('aria-hidden','true'); notesEl.innerHTML = ''; } } catch (e) {}
          return;
        }

        if (state === 'error') {
          const errorText = payload?.code === 'missing-latest-yml'
            ? 'In-app updater metadata is missing on the release. Use Open Latest Release.'
            : `Auto update failed: ${payload?.error || 'Unknown error.'}`;
          setUpdateStatus(errorText);
          setUpdateModalProgress(errorText);
          if (updateModalDownloadBtn && updateModalDownloadBtn.textContent !== 'Downloaded') {
            updateModalDownloadBtn.disabled = false;
            updateModalDownloadBtn.textContent = 'Download Update';
          }
          toggleInstallNowButton(false);
          try { const notesEl = document.getElementById('updateModalNotes'); if (notesEl) { notesEl.hidden = true; notesEl.setAttribute('aria-hidden','true'); notesEl.innerHTML = ''; } } catch (e) {}
        }
      });
    }

    if (checkForUpdatesBtn) {
      checkForUpdatesBtn.addEventListener('click', async () => {
        if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') {
          setUpdateStatus('Update check is unavailable in this runtime.');
          return;
        }

        checkForUpdatesBtn.disabled = true;
        latestReleaseUrl = DEFAULT_LATEST_RELEASE_URL;
        toggleOpenLatestButton(/^https?:\/\//i.test(latestReleaseUrl));
        setUpdateStatus('Checking for updates...');

        try {
          const result = await ipcRenderer.invoke('app-update:check');
          const currentVersion = String(result?.currentVersion || 'unknown');
          const latestVersion = String(result?.latestVersion || '').trim();
          latestReleaseUrl = String(result?.releaseUrl || latestReleaseUrl || DEFAULT_LATEST_RELEASE_URL || '').trim();
          toggleOpenLatestButton(/^https?:\/\//i.test(latestReleaseUrl));
          inAppDownloadAvailable = result?.manualDownloadOnly !== true;
          if (result?.warning) {
            setUpdateStatus(result.warning);
          }

          if (!result || result.ok !== true) {
            setUpdateStatus(result?.error || 'Update check failed.');
            return;
          }

          if (result.usingAutoUpdater) {
            if (result.updateAvailable) {
              setUpdateStatus(result.message || (latestVersion ? `Update available: ${latestVersion}.` : 'Update available.'));
            } else {
              setUpdateStatus('No Updates Found');
            }
            return;
          }

          if (result.updateAvailable && latestVersion) {
            latestReleaseUrl = String(result.releaseUrl || '').trim();
            setUpdateStatus(inAppDownloadAvailable
              ? `Update available: ${latestVersion} (current: ${currentVersion}).`
              : `Update available: ${latestVersion} (current: ${currentVersion}). In-app download is unavailable; use Open Latest Release.`);
            toggleOpenLatestButton(/^https?:\/\//i.test(latestReleaseUrl));
            toggleInstallNowButton(false);
            setUpdateModalMessage(inAppDownloadAvailable
              ? `Update available: ${latestVersion}. Do you want to download it now?`
              : `Update available: ${latestVersion}. In-app download is unavailable for this release.`);
            if (updateModalDownloadBtn) {
              updateModalDownloadBtn.disabled = !inAppDownloadAvailable;
              updateModalDownloadBtn.textContent = inAppDownloadAvailable ? 'Download Update' : 'In-App Download Unavailable';
            }
            // Render release notes from manual check if provided
            try {
              const notesEl = document.getElementById('updateModalNotes');
              const notesHtml = String(result?.releaseNotes || '').trim();
              if (notesEl) {
                if (notesHtml) {
                  notesEl.hidden = false;
                  notesEl.setAttribute('aria-hidden', 'false');
                  notesEl.innerHTML = notesHtml;
                } else {
                  notesEl.hidden = true;
                  notesEl.setAttribute('aria-hidden', 'true');
                  notesEl.innerHTML = '';
                }
              }
            } catch (e) {}
            setUpdateModalVisible(true);
            return;
          }

          if (latestVersion) {
            setUpdateStatus('No Updates Found');
          } else {
            setUpdateStatus('No Updates Found');
          }
          toggleInstallNowButton(false);
        } catch (error) {
          setUpdateStatus(`Update check failed: ${error.message}`);
        } finally {
          checkForUpdatesBtn.disabled = false;
        }
      });
    }

    if (openLatestReleaseBtn) {
      openLatestReleaseBtn.addEventListener('click', async () => {
        const targetUrl = String(latestReleaseUrl || DEFAULT_LATEST_RELEASE_URL || '').trim();
        if (!targetUrl) {
          setUpdateStatus('No release link available for this update source.');
          return;
        }

        if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') {
          shell.openExternal(targetUrl);
          return;
        }

        try {
          const openResult = await ipcRenderer.invoke('app-update:open-url', targetUrl);
          if (!openResult || openResult.ok !== true) {
            setUpdateStatus(openResult?.error || 'Failed to open release page.');
          }
        } catch (error) {
          setUpdateStatus(`Failed to open release page: ${error.message}`);
        }
      });
    }

    if (updateModalDownloadBtn) {
      updateModalDownloadBtn.addEventListener('click', async () => {
        if (!inAppDownloadAvailable) {
          setUpdateStatus('In-app download is unavailable for this release. Use Open Latest Release.');
          return;
        }
        if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') {
          setUpdateStatus('In-app download is unavailable in this runtime.');
          return;
        }

        updateModalDownloadBtn.disabled = true;
        updateModalDownloadBtn.textContent = 'Starting Download...';
        setUpdateModalProgress('Preparing download...');

        try {
          const downloadResult = await ipcRenderer.invoke('app-update:download');
          if (!downloadResult || downloadResult.ok !== true) {
            const message = downloadResult?.code === 'missing-latest-yml'
              ? 'In-app download is unavailable because latest.yml is missing. Use Open Latest Release.'
              : (downloadResult?.error || 'Failed to start update download.');
            setUpdateStatus(message);
            setUpdateModalProgress(message);
            updateModalDownloadBtn.disabled = false;
            updateModalDownloadBtn.textContent = 'Download Update';
            return;
          }

          setUpdateStatus('Downloading update...');
          setUpdateModalProgress('Downloading update...');
          updateModalDownloadBtn.textContent = 'Downloading...';
        } catch (error) {
          const message = `Failed to start update download: ${error.message}`;
          setUpdateStatus(message);
          setUpdateModalProgress(message);
          updateModalDownloadBtn.disabled = false;
          updateModalDownloadBtn.textContent = 'Download Update';
        }
      });
    }

    if (updateModalInstallBtn) {
      updateModalInstallBtn.addEventListener('click', async () => {
        if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') {
          setUpdateStatus('Install action is unavailable in this runtime.');
          return;
        }

        updateModalInstallBtn.disabled = true;
        setUpdateStatus('Restarting to install update...');
        setUpdateModalProgress('Restarting to install update...');

        try {
          const installResult = await ipcRenderer.invoke('app-update:quit-and-install');
          if (!installResult || installResult.ok !== true) {
            const message = installResult?.error || 'No downloaded update is ready to install yet.';
            setUpdateStatus(message);
            setUpdateModalProgress(message);
            updateModalInstallBtn.disabled = false;
          }
        } catch (error) {
          const message = `Install failed: ${error.message}`;
          setUpdateStatus(message);
          setUpdateModalProgress(message);
          updateModalInstallBtn.disabled = false;
        }
      });
    }

    sensorSelection = loadSensorSelection();
    sensorCategorySelection = loadSensorCategorySelection();
    sensorCategoryCollapse = loadSensorCategoryCollapse();
    sensorOrderByGroup = loadSensorOrder();
    const sensorOptions = document.getElementById('sensorOptions');
    if (sensorOptions) {
      const sensorDragState = {
        group: '',
        sensorId: '',
        overSensorId: '',
        placeAfter: false
      };

      const clearSensorDragClasses = () => {
        sensorOptions.querySelectorAll('.sensor-item-row.dragging, .sensor-item-row.drag-over-before, .sensor-item-row.drag-over-after').forEach((row) => {
          row.classList.remove('dragging', 'drag-over-before', 'drag-over-after');
        });
      };

      sensorOptions.addEventListener('click', (e) => {
        const renameButton = e.target.closest('[data-rename-sensor-id]');
        if (renameButton) {
          e.preventDefault();
          e.stopPropagation();
          const sensorId = String(renameButton.dataset.renameSensorId || '').trim();
          if (!sensorId) return;
          const row = renameButton.closest('.sensor-item-row[data-order-sensor-id]');
          const nameEl = row ? row.querySelector('.sensor-name') : null;
          const fallbackName = nameEl ? String(nameEl.textContent || '').trim() : '';
          startInlineSensorRename(row, sensorId, fallbackName);
          return;
        }

        const toggle = e.target.closest('[data-toggle-sensor-group]');
        if (!toggle) return;

        e.preventDefault();
        e.stopPropagation();

        const group = toggle.dataset.toggleSensorGroup;
        if (!group) return;

        const block = toggle.closest('.sensor-category-block');
        if (!block) return;

        const nextCollapsed = !block.classList.contains('is-collapsed');
        block.classList.toggle('is-collapsed', nextCollapsed);

        const itemsWrap = block.querySelector('.sensor-category-items');
        if (itemsWrap) {
          itemsWrap.classList.toggle('is-collapsed', nextCollapsed);
        }

        toggle.setAttribute('aria-expanded', nextCollapsed ? 'false' : 'true');
        sensorCategoryCollapse[group] = nextCollapsed;
        saveSensorCategoryCollapse();
      });

      sensorOptions.addEventListener('change', (e) => {
        const target = e.target;
        if (target && target.dataset && target.dataset.sensorGroup) {
          sensorCategorySelection[target.dataset.sensorGroup] = !!target.checked;
          saveSensorCategorySelection();
          sensorCatalogSignature = '';
          liveSensorCatalogSignature = '';
          updateStats();
          return;
        }
        if (target && target.dataset && target.dataset.sensorId) {
          sensorSelection[target.dataset.sensorId] = !!target.checked;
          saveSensorSelection();
          updateStats();
        }
      });

      sensorOptions.addEventListener('contextmenu', (e) => {
        const row = e.target.closest('.sensor-item-row[data-order-sensor-id]');
        if (!row) return;

        e.preventDefault();
        e.stopPropagation();

        const sensorId = String(row.dataset.orderSensorId || '').trim();
        if (!sensorId) return;

        const nameEl = row.querySelector('.sensor-name');
        const fallbackName = nameEl ? String(nameEl.textContent || '').trim() : '';
        startInlineSensorRename(row, sensorId, fallbackName);
      });

      sensorOptions.addEventListener('dragstart', (e) => {
        const row = e.target.closest('.sensor-item-row[data-order-group][data-order-sensor-id]');
        if (!row) return;

        if (row.classList.contains('is-renaming')) {
          e.preventDefault();
          return;
        }

        if (e.target.closest('input,button')) {
          e.preventDefault();
          return;
        }

        sensorDragState.group = row.dataset.orderGroup || '';
        sensorDragState.sensorId = row.dataset.orderSensorId || '';
        sensorDragState.overSensorId = '';
        sensorDragState.placeAfter = false;

        if (!sensorDragState.group || !sensorDragState.sensorId) {
          e.preventDefault();
          return;
        }

        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', `${sensorDragState.group}:${sensorDragState.sensorId}`);
        }

        setTimeout(() => {
          row.classList.add('dragging');
        }, 0);
      });

      sensorOptions.addEventListener('dragover', (e) => {
        const targetRow = e.target.closest('.sensor-item-row[data-order-group][data-order-sensor-id]');
        if (!targetRow || !sensorDragState.sensorId) return;

        const targetGroup = targetRow.dataset.orderGroup || '';
        const targetSensorId = targetRow.dataset.orderSensorId || '';
        if (!targetGroup || !targetSensorId || targetGroup !== sensorDragState.group || targetSensorId === sensorDragState.sensorId) return;

        e.preventDefault();
        const rect = targetRow.getBoundingClientRect();
        const placeAfter = (e.clientY - rect.top) > (rect.height / 2);

        clearSensorDragClasses();
        sensorOptions.querySelector(`.sensor-item-row[data-order-group="${sensorDragState.group}"][data-order-sensor-id="${sensorDragState.sensorId}"]`)?.classList.add('dragging');
        targetRow.classList.add(placeAfter ? 'drag-over-after' : 'drag-over-before');
        sensorDragState.overSensorId = targetSensorId;
        sensorDragState.placeAfter = placeAfter;
      });

      sensorOptions.addEventListener('drop', (e) => {
        const targetRow = e.target.closest('.sensor-item-row[data-order-group][data-order-sensor-id]');
        if (!targetRow || !sensorDragState.sensorId || !sensorDragState.group) return;

        e.preventDefault();
        const targetGroup = targetRow.dataset.orderGroup || '';
        const targetSensorId = targetRow.dataset.orderSensorId || '';
        if (targetGroup !== sensorDragState.group || !targetSensorId || targetSensorId === sensorDragState.sensorId) {
          clearSensorDragClasses();
          return;
        }

        moveSensorOrderByDrop(sensorDragState.group, sensorDragState.sensorId, targetSensorId, sensorDragState.placeAfter);
        clearSensorDragClasses();
      });

      sensorOptions.addEventListener('dragend', () => {
        sensorDragState.group = '';
        sensorDragState.sensorId = '';
        sensorDragState.overSensorId = '';
        sensorDragState.placeAfter = false;
        clearSensorDragClasses();
      });
    }

    // Restore saved settings
    const savedTheme = ThemeManager.getTheme();
    const savedRefreshRate = localStorage.getItem('refreshRate');
    
    if (savedTheme !== 'blue') {
      document.querySelector(`[data-theme="${savedTheme}"]`).click();
    }
    CustomColorManager.applyColors(CustomColorManager.getColors());
    
    if (savedRefreshRate) {
      updateInterval = clampRefreshInterval(savedRefreshRate);
      refreshSlider.value = String(updateInterval);
      refreshValue.textContent = String(updateInterval);
      localStorage.setItem('refreshRate', String(updateInterval));
    }

    initializeSetupGuideModal();
    initializeImportSettingsModal();
  }
};

async function updateStats(forceRender = false) {
  const providerSelection = loadProviderSelection();

  if (updateInProgress) {
    rerunUpdateRequested = true;
    return;
  }
  updateInProgress = true;

  try {
    const rawMode = localStorage.getItem('detectionMode') || 'msi';
    const mode = rawMode === 'msi' ? 'msi' : 'msi';
    if (rawMode !== mode) {
      localStorage.setItem('detectionMode', mode);
    }

    const isDocumentHidden = typeof document !== 'undefined' && !!document.hidden;
    const webMonitorActive = !!(webMonitorRuntime && webMonitorRuntime.running);
    if (isDocumentHidden && !webMonitorActive) {
      return;
    }

    const aidaPath = localStorage.getItem('aidaPath') || '';
    const data = await sensorReader.getEnhancedData(mode, { aidaPath, providers: providerSelection });
    
    // update external group title
    const titleEl = document.querySelector('#externalGroup .sensor-group-title');
    if (titleEl) {
      titleEl.innerHTML = '<i class="bi bi-tools group-icon" aria-hidden="true"></i><span>Other</span>';
    }

    if (!data) {
      const now = Date.now();
      if ((now - lastSuccessfulSensorReadAt) > SENSOR_READ_STALE_HOLD_MS) {
        latestSelectedGroupedSensors = createEmptyGroupedBuckets();
      }
      renderAllDynamicGroups(latestSelectedGroupedSensors);
      publishWebMonitorPayload(mode, 'No data');
      return;
    }

    // External sensor data (MSI Afterburner/RTSS)
    if (data.external && typeof data.external === 'object') {
      const externalInfo = [];
      const externalFps = Number(data.external.fps);
      const externalFrameTimeRaw = Number(data.external.frameTime);
      const normalizedFrameTime = (Number.isFinite(externalFrameTimeRaw) && externalFrameTimeRaw > 0)
        ? externalFrameTimeRaw
        : (Number.isFinite(externalFps) && externalFps > 0 ? (1000 / externalFps) : 0);
      
      // MSI Afterburner format (FPS info)
      if (Number.isFinite(externalFps) && externalFps > 0) {
        externalInfo.push(`FPS: ${externalFps.toFixed(0)}`);
      }
      if (Number.isFinite(normalizedFrameTime) && normalizedFrameTime > 0) {
        externalInfo.push(`Frame Time: ${normalizedFrameTime.toFixed(2)}ms`);
      }

      if (mode === 'msi' && data.external.groupedSensors) {
        const groupedWithRealtime = enrichGroupedSensorsWithRealtime(data.external.groupedSensors, {
          ...data.external,
          fps: Number.isFinite(externalFps) ? externalFps : data.external.fps,
          frameTime: Number.isFinite(normalizedFrameTime) ? normalizedFrameTime : data.external.frameTime
        });

        const nextCatalogSignature = buildLiveSensorCatalogSignature(groupedWithRealtime);
        if (!liveSensorCatalogSignature || liveSensorCatalogSignature !== nextCatalogSignature) {
          rebuildCachedSensorCatalog(groupedWithRealtime);
          liveSensorCatalogSignature = nextCatalogSignature;
        }

        const selected = buildSelectedSensorsFromCachedCatalog(groupedWithRealtime);
        latestSelectedGroupedSensors = selected;
        updateSensorHistory(selected);
        if (shouldCollectSummaryStats()) {
          updateSensorSessionStats(selected);
        }
        lastSuccessfulSensorReadAt = Date.now();
        renderAllDynamicGroups(selected, { force: forceRender });
      } else {
        const now = Date.now();
        if ((now - lastSuccessfulSensorReadAt) > SENSOR_READ_STALE_HOLD_MS) {
          latestSelectedGroupedSensors = createEmptyGroupedBuckets();
        }
        renderAllDynamicGroups(latestSelectedGroupedSensors, { force: forceRender });
      }
      
      const externalText = externalInfo.length > 0 ? externalInfo.join(' | ') : 'No data';
      publishWebMonitorPayload(mode, externalText);
    } else {
      const now = Date.now();
      if ((now - lastSuccessfulSensorReadAt) > SENSOR_READ_STALE_HOLD_MS) {
        latestSelectedGroupedSensors = createEmptyGroupedBuckets();
      }
      renderAllDynamicGroups(latestSelectedGroupedSensors, { force: forceRender });
      publishWebMonitorPayload(mode, 'N/A');
    }

  } catch (error) {
  } finally {
    updateInProgress = false;
    if (rerunUpdateRequested) {
      rerunUpdateRequested = false;
      setTimeout(() => {
        updateStats(true);
      }, 0);
    }
  }
}

function scheduleNextUpdateTick() {
  if (!updateLoopActive) return;

  const delay = Math.max(0, nextUpdateDueAt - Date.now());
  clearTimeout(updateTimer);
  updateTimer = setTimeout(async () => {
    if (!updateLoopActive) return;

    await updateStats(true);

    if (!updateLoopActive) return;
    const now = Date.now();
    do {
      nextUpdateDueAt += updateInterval;
    } while (nextUpdateDueAt <= now);
    scheduleNextUpdateTick();
  }, delay);
}

function restartUpdateTimer() {
  clearTimeout(updateTimer);
  updateLoopActive = true;
  nextUpdateDueAt = Date.now() + updateInterval;
  scheduleNextUpdateTick();
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  document.title = APP_VERSION ? `SiR System Monitor v${APP_VERSION}` : 'SiR System Monitor';
  expandedGraphSensors = loadExpandedGraphSensors();
  SettingsManager.init();
  setupSidebarResize();
  applyWindowOrder();
  applyWindowSizes();
  setupWindowResize();
  setupWindowDragAndDrop();
  setupSensorGraphInteractions();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && pendingVisibilityRefresh) {
      invalidateRenderGroupCache();
      renderAllDynamicGroups(latestSelectedGroupedSensors || createEmptyGroupedBuckets(), { force: true });
    }
  });
  updateStats();
  restartUpdateTimer();
});

window.addEventListener('beforeunload', () => {
  updateLoopActive = false;
  clearTimeout(updateTimer);
  stopWebMonitorServer();
});