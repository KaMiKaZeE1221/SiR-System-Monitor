const SensorReader = require('./sensorReader');
const {
  classifyNetworkSensor,
  resolveNetworkDisplayUnits,
  scaleBinaryNetworkValue
} = require('./networkUnits');
const {
  DEFAULT_LAYOUT_PRESET,
  LAYOUT_PRESET_STORAGE_KEY,
  CUSTOM_LAYOUT_CONFIG_STORAGE_KEY,
  CUSTOM_LAYOUT_SIZES_STORAGE_KEY,
  SUMMARY_LAYOUT_PRESET_STORAGE_KEY,
  SUMMARY_CUSTOM_LAYOUT_CONFIG_STORAGE_KEY,
  SUMMARY_CUSTOM_LAYOUT_SIZES_STORAGE_KEY,
  normalizeLayoutPreset,
  getLayoutPreset
} = require('./layoutPresets');
const { reorderVisibleSensors } = require('./sensorOrder');
const { listEnabledAlertSensors } = require('./sensorAlerts');
const {
  SENSOR_DETECTING_VALUE,
  createSensorCatalogCachePayload,
  parseSensorCatalogCache,
  mergeLiveAndCachedCatalog
} = require('./sensorCatalogCache');
const { buildAppTelemetrySensors } = require('./appTelemetry');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
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
let overlaySensorSelection = {};
let sensorCategorySelection = {};
let sensorCategoryCollapse = {};
let sensorOrderByGroup = {};
let sensorSearchSessionActive = false;
const sensorSearchCollapsedGroups = new Set();
let overlayCategoryOrderCache = null;
let sensorCatalogSignature = '';
let updateInProgress = false;
let rerunUpdateRequested = false;
let updateLoopActive = false;
let nextUpdateDueAt = 0;
let mainProcessUpdateClockActive = false;
let updateClockRequestId = 0;
let lastSuccessfulSensorReadAt = 0;
let lastSensorReadDurationMs = 0;
let lastUpdateCycleDurationMs = 0;
let lastAppRuntimeStats = {};
const SENSOR_READ_STALE_HOLD_MS = 8000;
const renderGroupSignatureCache = {};
const SENSOR_SELECTION_KEY = 'sensorSelection';
const SENSOR_HIDE_UNTICKED_KEY = 'sensorHideUnticked';
const SENSOR_CATEGORY_SELECTION_KEY = 'sensorCategorySelection';
const SENSOR_CATEGORY_COLLAPSE_KEY = 'sensorCategoryCollapse';
const SENSOR_ORDER_KEY = 'sensorOrderByGroup';
const FONT_SIZE_KEY = 'fontSize';
const FONT_FAMILY_KEY = 'fontFamily';
const VALUE_FONT_MONOSPACE_KEY = 'valueFontMonospace';
const FONT_BOLD_KEY = 'fontBold';
const DISABLE_GLOW_EFFECTS_KEY = 'disableGlowEffects';
const DISABLE_SETTINGS_ANIMATIONS_KEY = 'disableSettingsAnimations';
const ANIMATION_SETTINGS_KEY = 'animationSettings';
const DISPLAY_MODE_KEY = 'displayMode';
const CUSTOM_COLOR_PALETTES_KEY = 'customColorPalettesV1';
const DEFAULT_ANIMATION_SETTINGS = Object.freeze({
  enabled: true,
  settingsDropdowns: true,
  dialogs: true,
  viewTransitions: true,
  sensorIcons: true,
  settingsIcons: true,
  speed: 'standard',
  intensity: 'balanced'
});
const ANIMATION_SPEED_PRESETS = Object.freeze({
  calm: Object.freeze({ iconMs: 6200, focusMs: 650, dialogMs: 320, viewMs: 440, groupMs: 420, sectionMs: 360 }),
  standard: Object.freeze({ iconMs: 4800, focusMs: 500, dialogMs: 240, viewMs: 340, groupMs: 320, sectionMs: 280 }),
  lively: Object.freeze({ iconMs: 3600, focusMs: 380, dialogMs: 180, viewMs: 260, groupMs: 250, sectionMs: 220 })
});
const ANIMATION_INTENSITY_PRESETS = Object.freeze({
  gentle: Object.freeze({ iconLift: 0.75, iconScale: 1.04, focusRotate: -4, focusScale: 1.1, viewDistance: 6, viewScale: 0.992, dialogDistance: 12, disclosureDistance: 3 }),
  balanced: Object.freeze({ iconLift: 1.5, iconScale: 1.08, focusRotate: -8, focusScale: 1.2, viewDistance: 10, viewScale: 0.985, dialogDistance: 20, disclosureDistance: 5 }),
  expressive: Object.freeze({ iconLift: 2.5, iconScale: 1.13, focusRotate: -12, focusScale: 1.28, viewDistance: 15, viewScale: 0.976, dialogDistance: 28, disclosureDistance: 8 })
});
const TEMPERATURE_UNIT_KEY = 'temperatureUnit';
const PROVIDER_SELECTION_KEY = 'providerSelection';
const SENSOR_CUSTOM_NAMES_KEY = 'sensorCustomNames';
const SENSOR_ALERT_RULES_KEY = 'sensorAlertRules';
const SENSOR_CATALOG_CACHE_KEY = 'sensorCatalogCacheV1';
const SETTINGS_ACCORDION_STATE_KEY = 'settingsAccordionState';
const WINDOW_ORDER_KEY = 'windowOrder';
const SUMMARY_WINDOW_ORDER_KEY = 'summaryWindowOrder';
const WINDOW_SIZE_KEY = 'windowSize';
const MONITORING_MODE_KEY = 'monitoringMode';
const SUMMARY_MODE_KEY = 'summaryMode';
const DEBUG_MODE_KEY = 'debugMode';
const VIEW_MODE_KEY = 'viewMode';
const LAYOUT_PRESET_KEY = LAYOUT_PRESET_STORAGE_KEY;
const CUSTOM_LAYOUT_CONFIG_KEY = CUSTOM_LAYOUT_CONFIG_STORAGE_KEY;
const CUSTOM_LAYOUT_SIZES_KEY = CUSTOM_LAYOUT_SIZES_STORAGE_KEY;
const SUMMARY_LAYOUT_PRESET_KEY = SUMMARY_LAYOUT_PRESET_STORAGE_KEY;
const SUMMARY_CUSTOM_LAYOUT_CONFIG_KEY = SUMMARY_CUSTOM_LAYOUT_CONFIG_STORAGE_KEY;
const SUMMARY_CUSTOM_LAYOUT_SIZES_KEY = SUMMARY_CUSTOM_LAYOUT_SIZES_STORAGE_KEY;
const SUMMARY_WINDOW_SIZE_KEY = 'summaryWindowSize';
const CUSTOM_LAYOUT_COLUMNS = 36;
const CUSTOM_LAYOUT_ROW_HEIGHT = 8;
const GRAPH_EXPANDED_KEY = 'graphExpandedSensors';
const WEB_MONITOR_SETTINGS_KEY = 'webMonitorSettings';
const OVERLAY_ENABLED_KEY = 'overlayEnabled';
const OVERLAY_FONT_SIZE_KEY = 'overlayFontSize';
const OVERLAY_FONT_FAMILY_KEY = 'overlayFontFamily';
const OVERLAY_FONT_BOLD_KEY = 'overlayFontBold';
const OVERLAY_TEXT_COLOR_KEY = 'overlayTextColor';
const OVERLAY_VALUE_COLOR_KEY = 'overlayValueColor';
const OVERLAY_BG_COLOR_KEY = 'overlayBackgroundColor';
const OVERLAY_OPACITY_KEY = 'overlayOpacity';
const OVERLAY_GROUP_SPACING_KEY = 'overlayGroupSpacing';
const OVERLAY_SCALE_KEY = 'overlayScale';
const OVERLAY_WIDTH_KEY = 'overlayWidth';
const OVERLAY_WIDTH_PRESET_KEY = 'overlayWidthPreset';
const OVERLAY_POSITION_KEY = 'overlayPosition';
const OVERLAY_STYLE_KEY = 'overlayStyle';
const OVERLAY_SHOW_UNITS_KEY = 'overlayShowUnits';
const OVERLAY_MONITOR_KEY = 'overlayMonitorId';
const OVERLAY_HOTKEY_KEY = 'overlayHotkey';
const OVERLAY_DRAG_UNLOCK_KEY = 'overlayDragUnlock';
const OVERLAY_CUSTOM_X_KEY = 'overlayCustomX';
const OVERLAY_CUSTOM_Y_KEY = 'overlayCustomY';
const OVERLAY_CUSTOM_POSITION_ENABLED_KEY = 'overlayCustomPositionEnabled';
const SENSOR_OVERLAY_SELECTION_KEY = 'overlaySensorSelection';
const SETUP_GUIDE_SUPPRESS_KEY = 'setupGuideSuppress';
const APP_BEHAVIOR_SETTINGS_KEY = 'appBehaviorSettings';
const SETTINGS_PROFILES_KEY = 'settingsProfiles';
const ACTIVE_SETTINGS_PROFILE_KEY = 'activeSettingsProfile';
const SIDEBAR_WIDTH_KEY = 'sidebarWidth';
const OVERLAY_GROUP_LINE_LIMITS_KEY = 'overlayGroupLineLimits';
const OVERLAY_LINE_LIMITS_EXPANDED_KEY = 'overlayLineLimitsExpanded';
const OVERLAY_CATEGORY_ORDER_KEY = 'overlayCategoryOrder';
const LATENCY_HOST_KEY = 'latencyHost';
const SETTINGS_SNAPSHOT_KEYS = [
  SENSOR_ORDER_KEY,
  SENSOR_SELECTION_KEY,
  SENSOR_HIDE_UNTICKED_KEY,
  SENSOR_OVERLAY_SELECTION_KEY,
  SENSOR_CATEGORY_SELECTION_KEY,
  SENSOR_CUSTOM_NAMES_KEY,
  'customColors',
  CUSTOM_COLOR_PALETTES_KEY,
  DISPLAY_MODE_KEY,
  VIEW_MODE_KEY,
  LAYOUT_PRESET_KEY,
  CUSTOM_LAYOUT_CONFIG_KEY,
  CUSTOM_LAYOUT_SIZES_KEY,
  SUMMARY_LAYOUT_PRESET_KEY,
  SUMMARY_CUSTOM_LAYOUT_CONFIG_KEY,
  SUMMARY_CUSTOM_LAYOUT_SIZES_KEY,
  'theme',
  FONT_SIZE_KEY,
  FONT_FAMILY_KEY,
  VALUE_FONT_MONOSPACE_KEY,
  FONT_BOLD_KEY,
  DISABLE_GLOW_EFFECTS_KEY,
  DISABLE_SETTINGS_ANIMATIONS_KEY,
  ANIMATION_SETTINGS_KEY,
  TEMPERATURE_UNIT_KEY,
  SUMMARY_MODE_KEY,
  'refreshRate',
  OVERLAY_ENABLED_KEY,
  OVERLAY_FONT_SIZE_KEY,
  OVERLAY_FONT_FAMILY_KEY,
  OVERLAY_FONT_BOLD_KEY,
  OVERLAY_TEXT_COLOR_KEY,
  OVERLAY_VALUE_COLOR_KEY,
  OVERLAY_BG_COLOR_KEY,
  OVERLAY_OPACITY_KEY,
  OVERLAY_GROUP_SPACING_KEY,
  OVERLAY_SCALE_KEY,
  OVERLAY_WIDTH_PRESET_KEY,
  OVERLAY_WIDTH_KEY,
  OVERLAY_POSITION_KEY,
  OVERLAY_STYLE_KEY,
  OVERLAY_SHOW_UNITS_KEY,
  OVERLAY_MONITOR_KEY,
  OVERLAY_HOTKEY_KEY,
  OVERLAY_DRAG_UNLOCK_KEY,
  OVERLAY_CUSTOM_X_KEY,
  OVERLAY_CUSTOM_Y_KEY,
  OVERLAY_CUSTOM_POSITION_ENABLED_KEY,
  OVERLAY_GROUP_LINE_LIMITS_KEY,
  OVERLAY_LINE_LIMITS_EXPANDED_KEY,
  OVERLAY_CATEGORY_ORDER_KEY,
  LATENCY_HOST_KEY,
  PROVIDER_SELECTION_KEY,
  WEB_MONITOR_SETTINGS_KEY,
  APP_BEHAVIOR_SETTINGS_KEY,
  SENSOR_ALERT_RULES_KEY,
  WINDOW_ORDER_KEY,
  SUMMARY_WINDOW_ORDER_KEY,
  WINDOW_SIZE_KEY,
  SUMMARY_WINDOW_SIZE_KEY,
  SIDEBAR_WIDTH_KEY,
  GRAPH_EXPANDED_KEY,
  'showFps',
  'showCpu',
  'showGpu',
  'showRam',
  'showPsu',
  'showFans',
  'showNetwork',
  'showLatency',
  'showDrives',
  'showApp',
  'showExternal'
];
const SENSOR_GROUP_ORDER = ['fps', 'cpu', 'gpu', 'ram', 'psu', 'fans', 'network', 'latency', 'drives', 'app', 'other'];
const SENSOR_GROUP_LABELS = {
  fps: 'FPS',
  cpu: 'CPU',
  gpu: 'GPU',
  ram: 'RAM',
  psu: 'PSU',
  fans: 'Fans',
  network: 'Network',
  latency: 'Ping',
  drives: 'Drives',
  app: 'App',
  other: 'Other'
};
const SENSOR_GROUP_ICONS = {
  cpu: 'bi-cpu-fill',
  gpu: 'bi-gpu-card',
  ram: 'bi-memory',
  psu: 'bi-plug-fill',
  fans: 'bi-fan',
  network: 'bi-globe',
  latency: 'bi-broadcast-pin',
  drives: 'bi-device-hdd-fill',
  fps: 'bi-graph-up',
  app: 'bi-window-stack',
  other: 'bi-tools'
};
const VIEW_MODE_GROUP_ICONS = {
  standard: {
    fps: 'bi-graph-up',
    cpu: 'bi-cpu-fill',
    gpu: 'bi-gpu-card',
    ram: 'bi-memory',
    psu: 'bi-plug-fill',
    fans: 'bi-fan',
    network: 'bi-globe',
    latency: 'bi-broadcast-pin',
    drives: 'bi-device-hdd-fill',
    app: 'bi-window-stack',
    other: 'bi-tools'
  },
  compact: {
    fps: 'bi-speedometer2',
    cpu: 'bi-speedometer2',
    gpu: 'bi-badge-8k',
    ram: 'bi-diagram-3',
    psu: 'bi-lightning-charge',
    fans: 'bi-wind',
    network: 'bi-wifi',
    latency: 'bi-broadcast',
    drives: 'bi-hdd-stack',
    app: 'bi-speedometer2',
    other: 'bi-stars'
  },
  wide: {
    fps: 'bi-graph-up-arrow',
    cpu: 'bi-cpu',
    gpu: 'bi-gpu-card',
    ram: 'bi-memory',
    psu: 'bi-plug',
    fans: 'bi-fan',
    network: 'bi-ethernet',
    latency: 'bi-broadcast',
    drives: 'bi-device-hdd',
    app: 'bi-activity',
    other: 'bi-sliders'
  },
  terminal: {
    fps: 'bi-activity',
    cpu: 'bi-terminal-fill',
    gpu: 'bi-pc-display-horizontal',
    ram: 'bi-diagram-2-fill',
    psu: 'bi-battery-half',
    fans: 'bi-arrow-repeat',
    network: 'bi-router-fill',
    latency: 'bi-activity',
    drives: 'bi-device-ssd-fill',
    app: 'bi-terminal-fill',
    other: 'bi-braces-asterisk'
  },
  rail: {
    fps: 'bi-layout-sidebar-inset',
    cpu: 'bi-cpu-fill',
    gpu: 'bi-gpu-card',
    ram: 'bi-memory',
    psu: 'bi-plug-fill',
    fans: 'bi-fan',
    network: 'bi-globe2',
    latency: 'bi-broadcast-pin',
    drives: 'bi-device-hdd-fill',
    app: 'bi-window-stack',
    other: 'bi-tools'
  },
  glass: {
    fps: 'bi-droplet-half',
    cpu: 'bi-cpu',
    gpu: 'bi-gpu-card',
    ram: 'bi-diagram-3',
    psu: 'bi-lightning',
    fans: 'bi-wind',
    network: 'bi-wifi',
    latency: 'bi-activity',
    drives: 'bi-hdd-stack',
    app: 'bi-speedometer2',
    other: 'bi-stars'
  },
  split: {
    fps: 'bi-grid-3x2-gap-fill',
    cpu: 'bi-cpu-fill',
    gpu: 'bi-gpu-card',
    ram: 'bi-memory',
    psu: 'bi-plug-fill',
    fans: 'bi-fan',
    network: 'bi-ethernet',
    latency: 'bi-broadcast',
    drives: 'bi-device-hdd',
    app: 'bi-activity',
    other: 'bi-sliders'
  },
  status: {
    fps: 'bi-shield-check',
    cpu: 'bi-cpu-fill',
    gpu: 'bi-gpu-card',
    ram: 'bi-memory',
    psu: 'bi-plug-fill',
    fans: 'bi-fan',
    network: 'bi-globe-americas',
    latency: 'bi-activity',
    drives: 'bi-device-hdd-fill',
    app: 'bi-shield-check',
    other: 'bi-check2-circle'
  }
};
const GROUP_CARD_IDS = {
  fps: 'fpsGroup',
  cpu: 'cpuGroup',
  gpu: 'gpuGroup',
  ram: 'ramGroup',
  psu: 'psuGroup',
  fans: 'fansGroup',
  network: 'networkGroup',
  latency: 'latencyGroup',
  drives: 'drivesGroup',
  app: 'appGroup',
  other: 'externalGroup'
};
const GROUP_VISIBILITY_KEYS = {
  fps: 'showFps',
  cpu: 'showCpu',
  gpu: 'showGpu',
  ram: 'showRam',
  psu: 'showPsu',
  fans: 'showFans',
  network: 'showNetwork',
  latency: 'showLatency',
  drives: 'showDrives',
  app: 'showApp',
  other: 'showExternal'
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
let dashboardViewTransitionTimer = null;
let debugModeEnabled = (function() {
  try {
    const raw = localStorage.getItem(DEBUG_MODE_KEY);
    if (raw === null) return false;
    return JSON.parse(raw) === true;
  } catch (e) {
    return false;
  }
})();
let lastDebugExternalData = null;
// Low Overhead mode removed
let latestSelectedGroupedSensors = createEmptyGroupedBuckets();
let liveSensorCatalogSignature = '';
let cachedOrderedSensorCatalog = createEmptyGroupedBuckets();
let cachedCatalogPreservingMissingSensors = false;
let sensorCustomNames = {};
let sensorAlertRules = {};
let sensorAlertLastTriggeredAt = {};
let activeSensorAlertState = {};
let pendingVisibilityRefresh = false;
let lastUiRenderAt = 0;
let forceNextUiRender = true;
let motionVisibilityObserver = null;
let ambientMotionTimer = null;
let ambientMotionCursor = 0;
let ambientMotionDurationMs = ANIMATION_SPEED_PRESETS.standard.iconMs;
let currentTemperatureUnit = 'c';
let webMonitorServer = null;
let webMonitorSockets = new Set();
let webMonitorLifecycleQueue = Promise.resolve();
let webMonitorDesiredEnabled = false;
let webMonitorRuntime = {
  running: false,
  error: '',
  urls: [],
  host: '127.0.0.1',
  port: 17381
};
const latencyState = {
  host: '1.1.1.1',
  samples: [],
  maxSamples: 120,
  total: 0,
  lost: 0,
  current: null,
  min: null,
  max: null,
  avg: null,
  lastProbeAt: 0,
  probing: false
};

function normalizeGroupLineLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 8;
  return Math.max(1, Math.min(40, Math.round(numeric)));
}

function normalizeOverlayGroupLineLimits(raw) {
  const defaults = {};
  SENSOR_GROUP_ORDER.forEach((group) => {
    defaults[group] = 8;
  });
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      parsed = {};
    }
  }
  const input = (parsed && typeof parsed === 'object') ? parsed : {};
  SENSOR_GROUP_ORDER.forEach((group) => {
    defaults[group] = normalizeGroupLineLimit(input[group]);
  });
  return defaults;
}

function getOverlayGroupLineLimits() {
  return normalizeOverlayGroupLineLimits(localStorage.getItem(OVERLAY_GROUP_LINE_LIMITS_KEY));
}

function normalizeLatencyHost(value) {
  const raw = String(value || '').trim();
  return raw || '1.1.1.1';
}

function parsePingLatencyMs(text) {
  const source = String(text || '');
  const patterns = [
    /time[=<]\s*(\d+(?:\.\d+)?)\s*ms/i,
    /Average\s*=\s*(\d+)\s*ms/i
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
  }
  return null;
}

function probeLatency(host) {
  return new Promise((resolve) => {
    execFile('ping', ['-n', '1', '-w', '1000', host], { windowsHide: true, timeout: 2500 }, (error, stdout = '', stderr = '') => {
      const ms = parsePingLatencyMs(`${stdout}\n${stderr}`);
      if (Number.isFinite(ms)) {
        resolve({ ok: true, ms });
        return;
      }
      resolve({ ok: false, ms: null });
    });
  });
}

async function sampleLatencyIfNeeded() {
  const host = normalizeLatencyHost(localStorage.getItem(LATENCY_HOST_KEY));
  latencyState.host = host;
  const now = Date.now();
  if (latencyState.probing) return;
  if ((now - latencyState.lastProbeAt) < Math.max(1000, updateInterval)) return;

  latencyState.lastProbeAt = now;
  latencyState.probing = true;
  try {
    const result = await probeLatency(host);
    latencyState.total += 1;
    if (result.ok && Number.isFinite(result.ms)) {
      latencyState.current = result.ms;
      latencyState.samples.push(result.ms);
      if (latencyState.samples.length > latencyState.maxSamples) latencyState.samples.shift();
      latencyState.min = latencyState.samples.length ? Math.min(...latencyState.samples) : null;
      latencyState.max = latencyState.samples.length ? Math.max(...latencyState.samples) : null;
      latencyState.avg = latencyState.samples.length
        ? (latencyState.samples.reduce((sum, n) => sum + n, 0) / latencyState.samples.length)
        : null;
    } else {
      latencyState.current = null;
      latencyState.lost += 1;
    }
  } finally {
    latencyState.probing = false;
  }
}

function clampRefreshInterval(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1000;
  return Math.max(1000, Math.min(5000, Math.round(numeric)));
}
let latestWebPayload = {
  app: 'SiR System Monitor',
  version: APP_VERSION,
  updatedAt: Date.now(),
  mode: 'builtin',
  external: 'N/A',
  groups: {},
  settings: {}
};

const DEFAULT_WEB_MONITOR_SETTINGS = {
  enabled: false,
  autoStart: true,
  host: '127.0.0.1',
  port: 17381,
  requireAuth: false,
  authToken: '',
  readOnlyApiMode: false
};

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
      port: Number.isFinite(Number(parsed.port)) ? Number(parsed.port) : DEFAULT_WEB_MONITOR_SETTINGS.port,
      requireAuth: parsed.requireAuth === true,
      authToken: typeof parsed.authToken === 'string' ? parsed.authToken.trim() : '',
      readOnlyApiMode: parsed.readOnlyApiMode === true
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
    port: normalizedPort,
    requireAuth: source.requireAuth === true,
    authToken: typeof source.authToken === 'string' ? source.authToken.trim() : '',
    readOnlyApiMode: source.readOnlyApiMode === true
  };
}

function saveWebMonitorSettings(settings) {
  const normalized = normalizeWebMonitorSettings(settings);
  localStorage.setItem(WEB_MONITOR_SETTINGS_KEY, JSON.stringify(normalized));
}

function normalizeAppBehaviorSettings(input) {
  const startupDelaySeconds = Number.isFinite(Number(input?.startupDelaySeconds))
    ? Math.max(0, Math.min(60, Math.round(Number(input.startupDelaySeconds))))
    : 0;

  return {
    launchAtStartup: !!input?.launchAtStartup,
    launchAsAdministrator: !!input?.launchAsAdministrator,
    startMinimized: !!input?.startMinimized,
    minimizeToTray: !!input?.minimizeToTray,
    closeToTray: !!input?.closeToTray,
    autoCheckForUpdates: input?.autoCheckForUpdates !== false,
    startupDelaySeconds,
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

function buildWebMonitorOpenUrl(baseUrl, settings) {
  if (!baseUrl) return '';
  const normalized = normalizeWebMonitorSettings(settings || loadWebMonitorSettings());
  if (!normalized.requireAuth || !normalized.authToken) return baseUrl;
  try {
    const target = new URL(baseUrl);
    target.searchParams.set('token', normalized.authToken);
    return target.toString();
  } catch (e) {
    return baseUrl;
  }
}

function generateWebMonitorToken() {
  try {
    return crypto.randomBytes(24).toString('hex');
  } catch (e) {
    return (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 48);
  }
}

function escapeJsString(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function buildWebMonitorHtml(authToken = '') {
  let headerLogoSrc = 'SiR_SM_Source_sq.png';
  let faviconSrc = 'SiR_SM_Circle.ico';
  let faviconMime = 'image/x-icon';
  try {
    const pngPath = path.join(__dirname, 'SiR_SM_Source_sq.png');
    if (fs.existsSync(pngPath)) {
      const buf = fs.readFileSync(pngPath);
      headerLogoSrc = `data:image/png;base64,${buf.toString('base64')}`;
    }

    const icoPath = path.join(__dirname, 'SiR_SM_Circle.ico');
    if (fs.existsSync(icoPath)) {
      const buf = fs.readFileSync(icoPath);
      faviconSrc = `data:image/x-icon;base64,${buf.toString('base64')}`;
      faviconMime = 'image/x-icon';
    } else if (fs.existsSync(pngPath)) {
      const buf = fs.readFileSync(pngPath);
      faviconSrc = `data:image/png;base64,${buf.toString('base64')}`;
      faviconMime = 'image/png';
    }
  } catch (e) {
    // fallback to relative path
  }

  const embeddedToken = escapeJsString(authToken);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>SiR Monitor Web View</title>
  <link rel="icon" type="${faviconMime}" href="${faviconSrc}" />
  <link rel="shortcut icon" type="${faviconMime}" href="${faviconSrc}" />
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
      --layout-card-min-width: 300px;
      --layout-card-default-width: 300px;
      --layout-card-height: 360px;
      --layout-card-gap: 14px;
      --motion-icon-duration: 4.8s;
      --motion-focus-duration: .5s;
      --motion-view-duration: .34s;
      --motion-icon-lift: 1.5px;
      --motion-icon-scale: 1.08;
      --motion-focus-rotate: -8deg;
      --motion-focus-scale: 1.2;
      --motion-view-distance: 10px;
      --motion-view-scale: .985;
    }
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; font-family: var(--font-family); background: var(--bg-primary); color: var(--text-primary); line-height: 1.35; }
    body.no-glow *, body.no-glow *::before, body.no-glow *::after { text-shadow: none !important; box-shadow: none !important; filter: none !important; }
    .wrap { max-width: 100%; margin: 0 auto; padding: 10px; }
    .header { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 14px; }
    .header-right { display: inline-flex; align-items: center; gap: 8px; }
    .title { font-size: calc(22px * var(--font-scale)); font-weight: var(--font-weight-bold); color: var(--text-primary); }
    .meta { color: var(--text-secondary); font-size: calc(13px * var(--font-scale)); }
    .summary-toggle { border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); border-radius: 7px; padding: 6px 10px; cursor: pointer; font-size: calc(12px * var(--font-scale)); font-weight: var(--font-weight-bold); }
    .summary-toggle[hidden] { display: none; }
    .summary-toggle:hover { background: var(--border-color); color: var(--text-primary); }
    .summary-toggle.active { border-color: var(--accent-light); background: linear-gradient(135deg, color-mix(in srgb, var(--accent-light) 76%, white), color-mix(in srgb, var(--accent) 88%, black)); color: #08111f; }
    body.display-light { color-scheme: light; }
    body.display-dark { color-scheme: dark; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--layout-card-min-width)), 1fr)); gap: var(--layout-card-gap); }
    body.layout-stacked .grid { grid-template-columns: minmax(0, 1fr); }
    body.layout-custom .grid { grid-template-columns: repeat(36, minmax(0, 1fr)); grid-auto-rows: 8px; grid-auto-flow: dense; }
    .card { border: 1px solid var(--border-color); border-radius: 10px; background: var(--bg-secondary); padding: 14px; height: var(--layout-card-height); overflow: hidden; display: flex; flex-direction: column; contain: layout style; }
    body.layout-custom .card { height: auto; min-width: 0; }
    .card h3 { margin: 0 0 10px; padding-bottom: 8px; border-bottom: 1px solid var(--bg-tertiary); font-size: calc(13px * var(--font-scale)); letter-spacing: .08em; color: var(--block-header-color); text-transform: uppercase; font-weight: var(--font-weight-bold); display: flex; align-items: center; gap: 8px; }
    .group-icon { color: var(--icon-color); font-size: calc(14px * var(--font-scale)); line-height: 1; }
    body:not(.no-sensor-icon-animations) .card .group-icon { transform-origin: center; }
    body:not(.no-sensor-icon-animations) .card .group-icon.ambient-icon-motion { animation: web-sensor-icon-live var(--motion-focus-duration) ease-in-out 1; }
    body:not(.no-sensor-icon-animations) .card:hover .group-icon { animation: web-sensor-icon-focus var(--motion-focus-duration) cubic-bezier(.22,.61,.36,1); }
    body.app-inactive .card .group-icon,
    body.motion-visibility-ready:not(.no-sensor-icon-animations) .card .group-icon:not(.motion-in-view) { animation-play-state: paused !important; }
    body.app-inactive *, body.app-inactive *::before, body.app-inactive *::after { animation-play-state: paused !important; }
    body.motion-visibility-ready:not(.no-sensor-icon-animations) .card .group-icon.motion-in-view { will-change: transform; }
    body.web-view-to-summary .card { animation: web-dashboard-to-summary var(--motion-view-duration) cubic-bezier(.22,.61,.36,1) both; }
    body.web-view-to-dashboard .card { animation: web-dashboard-to-standard var(--motion-view-duration) cubic-bezier(.22,.61,.36,1) both; }
    @keyframes web-sensor-icon-live { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(calc(-1 * var(--motion-icon-lift))) scale(var(--motion-icon-scale)); } }
    @keyframes web-sensor-icon-focus { 0% { transform: rotate(0) scale(1); } 45% { transform: rotate(var(--motion-focus-rotate)) scale(var(--motion-focus-scale)); } 100% { transform: rotate(0) scale(1); } }
    @keyframes web-dashboard-to-summary { from { opacity: .45; transform: translateY(var(--motion-view-distance)) scale(var(--motion-view-scale)); } to { opacity: 1; transform: translateY(0) scale(1); } }
    @keyframes web-dashboard-to-standard { from { opacity: .45; transform: translateY(calc(-.8 * var(--motion-view-distance))) scale(var(--motion-view-scale)); } to { opacity: 1; transform: translateY(0) scale(1); } }
    .rows { overflow-y: auto; min-height: 0; flex: 1 1 auto; scrollbar-gutter: stable both-edges; padding-right: 8px; padding-bottom: 28px; scroll-padding-bottom: 28px; }
    .row { display: block; border-bottom: 1px solid var(--border-color); padding: 9px 0; font-size: calc(13px * var(--font-scale)); }
    .row.row-alert-warning { border-left: 2px solid #f7cf62; padding-left: 8px; }
    .row.row-alert-critical { border-left: 2px solid #ff6b6b; padding-left: 8px; }
    .row.row-alert-warning .label, .row.row-alert-warning .value { color: #f7cf62; }
    .row.row-alert-critical .label, .row.row-alert-critical .value { color: #ff6b6b; }
    .row:last-child { border-bottom: none; }
    .row-main { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
    .label { color: var(--sensor-label-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--font-weight-regular); }
    .value { color: var(--sensor-value-color); font-family: var(--value-font-family); white-space: normal; overflow-wrap: anywhere; word-break: break-word; text-align: right; max-width: 58%; font-weight: var(--font-weight-bold); }
    .empty { color: var(--text-secondary); font-size: calc(13px * var(--font-scale)); }
    .error { color: #ff8f8f; }
    .graph { width: 100%; height: 58px; margin-top: 6px; display: block; }
    .graph-line { fill: none; stroke: var(--graph-color); stroke-width: 2; vector-effect: non-scaling-stroke; }
    .graph-meta { margin-top: 3px; display: flex; justify-content: space-between; gap: 6px; color: var(--text-secondary); font-size: calc(10px * var(--font-scale)); }
    body.summary-mode .wrap { max-width: 100%; }
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
    body.view-compact .wrap { max-width: 100%; }
    body.view-compact .card {
      padding: 12px;
      border-radius: 18px;
      border-color: color-mix(in srgb, var(--accent-light) 40%, var(--border-color));
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-light) 25%, transparent), 0 10px 24px color-mix(in srgb, var(--accent) 18%, transparent);
      background: linear-gradient(180deg, color-mix(in srgb, var(--bg-secondary) 90%, var(--accent) 10%), var(--bg-secondary));
    }
    body.view-wide .wrap { max-width: 100%; }
    body.view-wide .card {
      padding: 14px;
      border-radius: 2px;
      border-width: 2px;
      box-shadow: none;
      background: color-mix(in srgb, var(--bg-secondary) 88%, var(--bg-primary) 12%);
    }
    body.view-wide .card h3 { letter-spacing: 0.12em; }
    body.view-terminal .wrap { max-width: 100%; }
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
    body.view-rail .card {
      border-radius: 12px;
      border-left: 4px solid var(--accent-light);
      box-shadow: 0 8px 20px color-mix(in srgb, var(--accent) 14%, transparent);
    }
    body.view-rail .card h3 { letter-spacing: 0.1em; }
    body.view-glass .card {
      border-radius: 16px;
      border-color: color-mix(in srgb, var(--accent-light) 26%, var(--border-color));
      background: color-mix(in srgb, var(--bg-secondary) 72%, transparent);
      backdrop-filter: blur(10px);
      box-shadow: 0 10px 24px color-mix(in srgb, black 35%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.06);
    }
    body.view-glass .row { border-bottom-color: color-mix(in srgb, var(--border-color) 70%, transparent); }
    body.view-split .card {
      padding-top: 0;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 8px 20px color-mix(in srgb, var(--accent) 10%, transparent);
    }
    body.view-split .card h3 {
      margin: 0 -14px 10px;
      padding: 10px 14px;
      background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 28%, var(--bg-secondary)), color-mix(in srgb, var(--bg-secondary) 92%, var(--bg-primary)));
      border-bottom: 1px solid color-mix(in srgb, var(--accent-light) 40%, var(--border-color));
    }
    body.view-status .card {
      position: relative;
      border-radius: 12px;
      border-color: color-mix(in srgb, var(--accent-light) 45%, var(--border-color));
    }
    body.view-status .card h3::after {
      content: 'LIVE';
      margin-left: auto;
      font-size: calc(9px * var(--font-scale));
      letter-spacing: 0.08em;
      color: #09180f;
      background: #3fe08c;
      border-radius: 999px;
      padding: 2px 7px;
      line-height: 1.4;
    }
    body.view-status .row.row-alert-warning .label,
    body.view-status .row.row-alert-warning .value {
      color: #ffe17f;
    }
    body.view-status .row.row-alert-critical .label,
    body.view-status .row.row-alert-critical .value {
      color: #ff8d8d;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div style="display: flex; align-items: center; gap: 12px;">
        <img src="${headerLogoSrc}" alt="SiR System Monitor" style="width: 44px; height: 44px; border-radius: 10px; object-fit: cover; box-shadow: 0 1px 6px #0004;" />
        <div class="title">SiR System Monitor</div>
        <div id="meta" class="meta">Waiting for data...</div>
      </div>
      <div class="header-right">
        <button id="summaryResetToggle" class="summary-toggle" type="button" hidden>Reset Stats</button>
        <button id="summaryModeToggle" class="summary-toggle" type="button">Summary Mode</button>
      </div>
    </div>
    <div id="grid" class="grid"></div>
  </div>

  <script>
    const groupOrder = ['fps', 'cpu', 'gpu', 'ram', 'psu', 'fans', 'network', 'latency', 'drives', 'app', 'other'];
    const groupLabels = { fps: 'FPS', cpu: 'CPU', gpu: 'GPU', ram: 'RAM', psu: 'PSU', fans: 'Fans', network: 'Network', latency: 'Ping', drives: 'Drives', app: 'App', other: 'Other' };
    const groupIconsByMode = {
      standard: { fps: 'bi-graph-up', cpu: 'bi-cpu-fill', gpu: 'bi-gpu-card', ram: 'bi-memory', psu: 'bi-plug-fill', fans: 'bi-fan', network: 'bi-globe', latency: 'bi-broadcast-pin', drives: 'bi-device-hdd-fill', app: 'bi-window-stack', other: 'bi-tools' },
      compact: { fps: 'bi-speedometer2', cpu: 'bi-speedometer2', gpu: 'bi-badge-8k', ram: 'bi-diagram-3', psu: 'bi-lightning-charge', fans: 'bi-wind', network: 'bi-wifi', latency: 'bi-broadcast', drives: 'bi-hdd-stack', app: 'bi-speedometer2', other: 'bi-stars' },
      wide: { fps: 'bi-graph-up-arrow', cpu: 'bi-cpu', gpu: 'bi-gpu-card', ram: 'bi-memory', psu: 'bi-plug', fans: 'bi-fan', network: 'bi-ethernet', latency: 'bi-broadcast', drives: 'bi-device-hdd', app: 'bi-activity', other: 'bi-sliders' },
      terminal: { fps: 'bi-activity', cpu: 'bi-terminal-fill', gpu: 'bi-pc-display-horizontal', ram: 'bi-diagram-2-fill', psu: 'bi-battery-half', fans: 'bi-arrow-repeat', network: 'bi-router-fill', latency: 'bi-activity', drives: 'bi-device-ssd-fill', app: 'bi-terminal-fill', other: 'bi-braces-asterisk' },
      rail: { fps: 'bi-layout-sidebar-inset', cpu: 'bi-cpu-fill', gpu: 'bi-gpu-card', ram: 'bi-memory', psu: 'bi-plug-fill', fans: 'bi-fan', network: 'bi-globe2', latency: 'bi-broadcast-pin', drives: 'bi-device-hdd-fill', app: 'bi-window-stack', other: 'bi-tools' },
      glass: { fps: 'bi-droplet-half', cpu: 'bi-cpu', gpu: 'bi-gpu-card', ram: 'bi-diagram-3', psu: 'bi-lightning', fans: 'bi-wind', network: 'bi-wifi', latency: 'bi-activity', drives: 'bi-hdd-stack', app: 'bi-droplet-half', other: 'bi-stars' },
      split: { fps: 'bi-grid-3x2-gap-fill', cpu: 'bi-cpu-fill', gpu: 'bi-gpu-card', ram: 'bi-memory', psu: 'bi-plug-fill', fans: 'bi-fan', network: 'bi-ethernet', latency: 'bi-broadcast', drives: 'bi-device-hdd', app: 'bi-grid-3x2-gap-fill', other: 'bi-sliders' },
      status: { fps: 'bi-shield-check', cpu: 'bi-cpu-fill', gpu: 'bi-gpu-card', ram: 'bi-memory', psu: 'bi-plug-fill', fans: 'bi-fan', network: 'bi-globe-americas', latency: 'bi-activity', drives: 'bi-device-hdd-fill', app: 'bi-shield-check', other: 'bi-check2-circle' }
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
      viewMode: 'standard',
      layoutPreset: 'balanced',
      layoutSignature: '',
      viewTransitionTimer: null,
      viewTransitionDurationMs: 340,
      ambientMotionTimer: null,
      ambientMotionCursor: 0,
      ambientMotionDurationMs: 4800
    };
    const motionVisibilityObserver = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            entry.target.classList.toggle('motion-in-view', entry.isIntersecting);
          });
        }, { rootMargin: '96px' })
      : null;

    function observeWebMotionTargets(root) {
      if (!motionVisibilityObserver || !root) return;
      root.querySelectorAll('.card .group-icon').forEach((icon) => {
        if (icon.classList.contains('motion-observed')) return;
        icon.classList.add('motion-observed');
        motionVisibilityObserver.observe(icon);
      });
      document.body.classList.add('motion-visibility-ready');
      scheduleWebAmbientIconMotion();
    }

    function scheduleWebAmbientIconMotion(delayMs = 250) {
      if (domState.ambientMotionTimer !== null) clearTimeout(domState.ambientMotionTimer);
      domState.ambientMotionTimer = setTimeout(runWebAmbientIconMotionCycle, Math.max(0, Number(delayMs) || 0));
    }

    function runWebAmbientIconMotionCycle() {
      document.querySelectorAll('.ambient-icon-motion').forEach((icon) => {
        icon.classList.remove('ambient-icon-motion');
      });
      if (document.body.classList.contains('app-inactive') || document.body.classList.contains('no-sensor-icon-animations')) {
        scheduleWebAmbientIconMotion(Math.max(1000, domState.ambientMotionDurationMs));
        return;
      }

      const icons = Array.from(document.querySelectorAll('.card .group-icon.motion-in-view'))
        .filter((icon) => icon.offsetParent !== null && !icon.matches(':hover'));
      if (icons.length) {
        const icon = icons[domState.ambientMotionCursor % icons.length];
        domState.ambientMotionCursor = (domState.ambientMotionCursor + 1) % icons.length;
        icon.classList.add('ambient-icon-motion');
      }
      scheduleWebAmbientIconMotion(domState.ambientMotionDurationMs + 200);
    }

    function syncWebActivityState() {
      const active = !document.hidden &&
        (typeof document.hasFocus !== 'function' || document.hasFocus());
      document.body.classList.toggle('app-inactive', !active);
      if (active) scheduleWebAmbientIconMotion(100);
      else if (domState.ambientMotionTimer !== null) clearTimeout(domState.ambientMotionTimer);
    }

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
      if (normalized === 'compact' || normalized === 'wide' || normalized === 'terminal' || normalized === 'rail' || normalized === 'glass' || normalized === 'split' || normalized === 'status') return normalized;
      return 'standard';
    }

    function applyViewMode(mode) {
      const nextMode = normalizeViewMode(mode);
      if (domState.viewMode === nextMode) return;
      domState.viewMode = nextMode;
      document.body.classList.remove('view-compact', 'view-wide', 'view-terminal', 'view-rail', 'view-glass', 'view-split', 'view-status');
      if (nextMode !== 'standard') {
        document.body.classList.add('view-' + nextMode);
      }
    }

    function normalizeWebAnimationSettings(settings) {
      const source = settings && typeof settings === 'object' ? settings : {};
      const speed = ['calm', 'standard', 'lively'].includes(String(source.speed || '').toLowerCase()) ? String(source.speed).toLowerCase() : 'standard';
      const intensity = ['gentle', 'balanced', 'expressive'].includes(String(source.intensity || '').toLowerCase()) ? String(source.intensity).toLowerCase() : 'balanced';
      return {
        enabled: source.enabled !== false,
        settingsDropdowns: source.settingsDropdowns !== false,
        dialogs: source.dialogs !== false,
        viewTransitions: source.viewTransitions !== false,
        sensorIcons: source.sensorIcons !== false,
        settingsIcons: source.settingsIcons !== false,
        speed,
        intensity
      };
    }

    function applyWebAnimationSettings(settings) {
      const normalized = normalizeWebAnimationSettings(settings);
      const speedPresets = {
        calm: { iconMs: 6200, focusMs: 650, viewMs: 440 },
        standard: { iconMs: 4800, focusMs: 500, viewMs: 340 },
        lively: { iconMs: 3600, focusMs: 380, viewMs: 260 }
      };
      const intensityPresets = {
        gentle: { iconLift: .75, iconScale: 1.04, focusRotate: -4, focusScale: 1.1, viewDistance: 6, viewScale: .992 },
        balanced: { iconLift: 1.5, iconScale: 1.08, focusRotate: -8, focusScale: 1.2, viewDistance: 10, viewScale: .985 },
        expressive: { iconLift: 2.5, iconScale: 1.13, focusRotate: -12, focusScale: 1.28, viewDistance: 15, viewScale: .976 }
      };
      const speed = speedPresets[normalized.speed];
      const intensity = intensityPresets[normalized.intensity];
      const root = document.documentElement;
      root.style.setProperty('--motion-icon-duration', speed.iconMs + 'ms');
      root.style.setProperty('--motion-focus-duration', speed.focusMs + 'ms');
      root.style.setProperty('--motion-view-duration', speed.viewMs + 'ms');
      root.style.setProperty('--motion-icon-lift', intensity.iconLift + 'px');
      root.style.setProperty('--motion-icon-scale', String(intensity.iconScale));
      root.style.setProperty('--motion-focus-rotate', intensity.focusRotate + 'deg');
      root.style.setProperty('--motion-focus-scale', String(intensity.focusScale));
      root.style.setProperty('--motion-view-distance', intensity.viewDistance + 'px');
      root.style.setProperty('--motion-view-scale', String(intensity.viewScale));
      domState.viewTransitionDurationMs = speed.viewMs;
      domState.ambientMotionDurationMs = speed.iconMs;
      document.body.classList.toggle('no-view-animations', !normalized.enabled || !normalized.viewTransitions);
      document.body.classList.toggle('no-sensor-icon-animations', !normalized.enabled || !normalized.sensorIcons);
      scheduleWebAmbientIconMotion(100);
      if (!normalized.enabled || !normalized.viewTransitions) {
        document.body.classList.remove('web-view-to-summary', 'web-view-to-dashboard');
        if (domState.viewTransitionTimer !== null) clearTimeout(domState.viewTransitionTimer);
        domState.viewTransitionTimer = null;
      }
    }

    function triggerWebViewTransition(toSummary) {
      if (document.body.classList.contains('no-view-animations')) return;
      const nextClass = toSummary ? 'web-view-to-summary' : 'web-view-to-dashboard';
      document.body.classList.remove('web-view-to-summary', 'web-view-to-dashboard');
      void document.body.offsetWidth;
      document.body.classList.add(nextClass);
      if (domState.viewTransitionTimer !== null) clearTimeout(domState.viewTransitionTimer);
      domState.viewTransitionTimer = setTimeout(() => {
        document.body.classList.remove(nextClass);
        domState.viewTransitionTimer = null;
      }, domState.viewTransitionDurationMs + 100);
    }

    function applyLayoutPreset(presetId, config) {
      const supported = ['compact', 'balanced', 'wide', 'stacked', 'custom'];
      const requested = String(presetId || '').toLowerCase();
      const normalized = supported.includes(requested) ? requested : 'balanced';
      const nextConfig = config && typeof config === 'object' ? config : {};
      const minCardWidth = Math.min(900, Math.max(180, Number(nextConfig.minCardWidth) || 300));
      const defaultCardWidth = Math.min(1200, Math.max(minCardWidth, Number(nextConfig.defaultCardWidth) || minCardWidth));
      const cardHeight = Math.min(900, Math.max(220, Number(nextConfig.cardHeight) || 360));
      const gap = Math.min(40, Math.max(0, Number(nextConfig.gap) || 14));
      const root = document.documentElement;
      const signature = [normalized, minCardWidth, defaultCardWidth, cardHeight, gap, nextConfig.stacked === true ? '1' : '0'].join('|');

      if (domState.layoutSignature === signature) return;

      domState.layoutPreset = normalized;
      domState.layoutSignature = signature;
      document.body.classList.toggle('layout-stacked', normalized === 'stacked' || nextConfig.stacked === true);
      document.body.classList.toggle('layout-custom', normalized === 'custom');
      root.style.setProperty('--layout-card-min-width', minCardWidth + 'px');
      root.style.setProperty('--layout-card-default-width', defaultCardWidth + 'px');
      root.style.setProperty('--layout-card-height', cardHeight + 'px');
      root.style.setProperty('--layout-card-gap', gap + 'px');
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
          return group + '#h' + (groupLayout.height || 0) + '#s' + (groupLayout.span || 0) + '#w' + (groupLayout.width || 0) + '#' + rowKey + '#summary:' + (domState.summaryMode ? '1' : '0') + '#view:' + domState.viewMode + '#layout:' + domState.layoutSignature;
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
      const minText = summary.minFormatted
        ? escapeHtml(summary.minFormatted)
        : formatSummaryMetric(summary.min, units, sensor.name);
      const averageText = summary.averageFormatted
        ? escapeHtml(summary.averageFormatted)
        : formatSummaryMetric(summary.average, units, sensor.name);
      const maxText = summary.maxFormatted
        ? escapeHtml(summary.maxFormatted)
        : formatSummaryMetric(summary.max, units, sensor.name);

      return '<div class="summary-line">' +
        '<span class="summary-part"><span class="summary-label">Min</span><span class="summary-value">' + minText + '</span></span>' +
        '<span class="summary-sep">•</span>' +
        '<span class="summary-part"><span class="summary-label">Avg</span><span class="summary-value">' + averageText + '</span></span>' +
        '<span class="summary-sep">•</span>' +
        '<span class="summary-part"><span class="summary-label">Max</span><span class="summary-value">' + maxText + '</span></span>' +
      '</div>';
    }

    function setSummaryMode(enabled, options) {
      const opts = options || {};
      const persist = opts.persist !== false;
      const requested = !!enabled;
      const changed = domState.summaryMode !== requested;
      domState.summaryMode = requested;
      document.body.classList.toggle('summary-mode', domState.summaryMode);
      const button = document.getElementById('summaryModeToggle');
      if (button) {
        button.textContent = domState.summaryMode ? 'Exit Summary Mode' : 'Summary Mode';
        button.classList.toggle('active', domState.summaryMode);
      }
      const resetButton = document.getElementById('summaryResetToggle');
      if (resetButton) resetButton.hidden = !domState.summaryMode;
      if (persist) {
        try {
          localStorage.setItem(SUMMARY_MODE_STORAGE_KEY, domState.summaryMode ? 'true' : 'false');
        } catch (e) {}
      }
      if (changed && opts.animate !== false) triggerWebViewTransition(domState.summaryMode);
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
      const displayMode = settings.displayMode === 'light' ? 'light' : 'dark';
      document.body.classList.toggle('display-light', displayMode === 'light');
      document.body.classList.toggle('display-dark', displayMode === 'dark');
      root.style.colorScheme = displayMode;

      applyViewMode(settings.viewMode || 'standard');
      const activeLayoutPreset = domState.summaryMode
        ? (settings.summaryLayoutPreset || 'balanced')
        : (settings.layoutPreset || 'balanced');
      const activeLayoutConfig = domState.summaryMode
        ? (settings.summaryLayoutConfig || {})
        : (settings.layoutConfig || {});
      applyLayoutPreset(activeLayoutPreset, activeLayoutConfig);

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
      document.body.classList.toggle('no-glow', !!settings.disableGlow);
      applyWebAnimationSettings(settings.animations);
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
      const gridStyles = getComputedStyle(grid);
      const customLayout = domState.layoutPreset === 'custom';
      const measuredColumns = Math.max(1, (gridStyles.gridTemplateColumns || '').split(' ').filter((track) => (parseFloat(track) || 0) > 1).length);
      const columns = customLayout ? 36 : measuredColumns;
      const gap = parseFloat(gridStyles.columnGap || gridStyles.gap || '10') || 10;
      const containerWidth = Math.max(1, grid.clientWidth || window.innerWidth || 1200);
      const columnWidth = Math.max(customLayout ? 1 : 120, (containerWidth - (gap * (columns - 1))) / columns);
      const configuredMinWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--layout-card-min-width')) || 180;
      const configuredDefaultWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--layout-card-default-width')) || configuredMinWidth;
      const configuredHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--layout-card-height')) || 360;

      orderedGroups.forEach((group) => {
        const sensors = Array.isArray(groups[group]) ? groups[group] : [];
        if (!sensors.length) return;

        const card = document.createElement('section');
        card.className = 'card';
        const groupLayout = layout[group] || {};
        const desiredWidth = Number(groupLayout.width);
        const targetWidth = Number.isFinite(desiredWidth) && desiredWidth >= configuredMinWidth ? desiredWidth : configuredDefaultWidth;
        if ((Number.isFinite(desiredWidth) && desiredWidth >= 180) || customLayout) {
          const rawSpan = Math.round((targetWidth + gap) / (columnWidth + gap));
          const webSpan = Math.min(Math.max(1, rawSpan), columns);
          card.style.gridColumn = 'span ' + webSpan;
        }
        const desiredHeight = Number(groupLayout.height);
        if (customLayout) {
          const targetHeight = Number.isFinite(desiredHeight) && desiredHeight >= 220 && desiredHeight <= 900 ? desiredHeight : configuredHeight;
          const rowSpan = Math.max(1, Math.round((targetHeight + gap) / (8 + gap)));
          card.style.gridRow = 'span ' + rowSpan;
          card.style.height = 'auto';
        } else if (Number.isFinite(desiredHeight) && desiredHeight >= 220 && desiredHeight <= 900) {
          card.style.height = desiredHeight + 'px';
        }

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
          const alertClass = sensor.alertSeverity === 'critical'
            ? ' row-alert-critical'
            : (sensor.alertSeverity === 'warning' ? ' row-alert-warning' : '');
          row.className = 'row' + alertClass;
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
          domState.rowsByKey.set(sensorKey, { rowEl: row, valueEl: value, graphEl: graphHolder, summaryEl: summaryHolder, labelEl: label });
        });

        card.appendChild(rowsWrap);
        grid.appendChild(card);

        const previousScroll = domState.rowScrollByGroup.get(group) || 0;
        rowsWrap.scrollTop = previousScroll;
      });

      observeWebMotionTargets(grid);
    }

    function updateGridValues(groups, orderedGroups) {
      orderedGroups.forEach((group) => {
        const sensors = Array.isArray(groups[group]) ? groups[group] : [];
        sensors.forEach((sensor) => {
          const sensorKey = makeSensorKey(group, sensor.id);
          const refs = domState.rowsByKey.get(sensorKey);
          if (!refs) return;
          if (refs.rowEl) {
            refs.rowEl.classList.remove('row-alert-warning', 'row-alert-critical');
            if (sensor.alertSeverity === 'critical') refs.rowEl.classList.add('row-alert-critical');
            else if (sensor.alertSeverity === 'warning') refs.rowEl.classList.add('row-alert-warning');
          }

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

      const rawMode = String(payload.mode || '').toLowerCase();
      const modeLabel = rawMode === 'builtin' ? 'Built-in Sensors' : (rawMode === 'msi' ? 'Shared Memory' : (payload.mode || 'N/A'));
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

        setSummaryMode(initialSummaryMode, { animate: false });
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

      applySyncedSettings(payload.settings || {});
      const groups = payload.groups || {};
      const layout = domState.summaryMode
        ? ((payload.settings && payload.settings.summaryGroupLayout) ? payload.settings.summaryGroupLayout : {})
        : ((payload.settings && payload.settings.groupLayout) ? payload.settings.groupLayout : {});
      const orderedGroups = domState.summaryMode
        ? (Array.isArray(payload.settings && payload.settings.summaryGroupOrder) ? payload.settings.summaryGroupOrder : groupOrder)
        : (Array.isArray(payload.settings && payload.settings.groupOrder) ? payload.settings.groupOrder : groupOrder);

      const structureKey = computeStructureKey(groups, orderedGroups, layout);
      if (structureKey !== domState.structureKey) {
        domState.structureKey = structureKey;
        rebuildGrid(groups, orderedGroups, layout, grid);
      }

      updateGridValues(groups, orderedGroups);
    }

    const authToken = "${embeddedToken}";
    let loading = false;
    window.addEventListener('resize', () => {
      domState.structureKey = '';
    });
    async function load() {
      if (loading || document.hidden) return;
      loading = true;
      try {
        const summaryParam = domState.summaryMode ? '1' : '0';
        const tokenSuffix = authToken ? ('&token=' + encodeURIComponent(authToken)) : '';
        const response = await fetch('/api/monitor?summary=' + summaryParam + tokenSuffix, { cache: 'no-store' });
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

    document.addEventListener('visibilitychange', () => {
      syncWebActivityState();
      if (!document.hidden) load();
    });
    window.addEventListener('focus', syncWebActivityState);
    window.addEventListener('blur', syncWebActivityState);
    syncWebActivityState();
    load();
    setInterval(load, 1000);
  </script>
</body>
</html>`;
}

function shouldCollectSummaryStats() {
  return true;
}

function publishWebMonitorPayload(mode, externalText) {
  const sizeMap = loadWindowSizes('normal');
  const summarySizeMap = loadWindowSizes('summary');
  const selectedLayoutPreset = getSelectedLayoutPreset('normal');
  const selectedLayoutConfig = getActiveLayoutConfig(selectedLayoutPreset, 'normal');
  const selectedSummaryLayoutPreset = getSelectedLayoutPreset('summary');
  const selectedSummaryLayoutConfig = getActiveLayoutConfig(selectedSummaryLayoutPreset, 'summary');
  const buildGroupOrder = (layoutMode) => {
    const orderedGroups = loadWindowOrder(layoutMode)
      .map((cardId) => CARD_GROUP_IDS[cardId])
      .filter((group) => !!group);
    const missingGroups = SENSOR_GROUP_ORDER.filter((group) => !orderedGroups.includes(group));
    return [...orderedGroups, ...missingGroups];
  };
  const groupOrder = buildGroupOrder('normal');
  const summaryGroupOrder = buildGroupOrder('summary');

  const buildGroupLayout = (savedSizes) => {
    const layout = {};
    SENSOR_GROUP_ORDER.forEach((group) => {
      const cardId = GROUP_CARD_IDS[group];
      const saved = savedSizes[cardId];
      const savedHeight = Number(typeof saved === 'object' ? saved.height : saved);
      const savedSpan = Number(typeof saved === 'object' && saved !== null ? saved.span : NaN);
      const savedWidth = Number(typeof saved === 'object' ? saved.width : NaN);

      layout[group] = {};
      if (Number.isFinite(savedHeight) && savedHeight >= 220 && savedHeight <= 900) {
        layout[group].height = savedHeight;
      }
      if (Number.isFinite(savedSpan) && savedSpan >= 1) {
        layout[group].span = savedSpan;
      }
      if (Number.isFinite(savedWidth) && savedWidth >= 180) {
        layout[group].width = savedWidth;
      }
    });
    return layout;
  };
  const groupLayout = buildGroupLayout(sizeMap);
  const summaryGroupLayout = buildGroupLayout(summarySizeMap);

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
  const isGroupVisible = (group) => {
    const key = GROUP_VISIBILITY_KEYS[group];
    if (!key) return true;
    const raw = localStorage.getItem(key);
    if (raw === null) return true;
    return raw === 'true';
  };
  SENSOR_GROUP_ORDER.forEach((group) => {
    if (!isGroupVisible(group)) {
      groups[group] = [];
      return;
    }
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
        name: getFinalDisplayLabel(sensor),
        value: hasNumericValue && normalizedCurrent ? normalizedCurrent.value : sensor.value,
        units: hasNumericValue && normalizedCurrent ? normalizedCurrent.units : resolvedUnits,
        formatted: formatSensorValue(sensorForFormatting),
        alertSeverity: activeSensorAlertState[sensor.id]?.severity || '',
        expanded: expandedGraphSensors.has(sensor.id),
        history,
        summary: (includeSummary && hasNumericValue) ? (() => {
          const stats = summarizeSensorSessionStats(sensorSessionStats[sensor.id]);
          if (!stats) {
            return { min: null, average: null, max: null, count: 0 };
          }
          const normalizedMin = normalizeValueForDisplay(sensorForFormatting, stats.min);
          const normalizedAverage = normalizeValueForDisplay(sensorForFormatting, stats.average);
          const normalizedMax = normalizeValueForDisplay(sensorForFormatting, stats.max);
          return {
            min: normalizedMin.value,
            average: normalizedAverage.value,
            max: normalizedMax.value,
            minFormatted: formatSensorNumericValue(sensorForFormatting, stats.min),
            averageFormatted: formatSensorNumericValue(sensorForFormatting, stats.average),
            maxFormatted: formatSensorNumericValue(sensorForFormatting, stats.max),
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
      disableGlow: localStorage.getItem(DISABLE_GLOW_EFFECTS_KEY) === 'true',
      animations: loadAnimationSettings(),
      temperatureUnit: selectedTempUnit,
      displayMode: getResolvedDisplayMode(),
      displayModePreference: getDisplayModePreference(),
      summaryMode: summaryModeEnabled,
      viewMode: normalizeViewMode(localStorage.getItem(VIEW_MODE_KEY) || 'standard'),
      layoutPreset: selectedLayoutPreset,
      layoutConfig: selectedLayoutConfig,
      summaryLayoutPreset: selectedSummaryLayoutPreset,
      summaryLayoutConfig: selectedSummaryLayoutConfig,
      groupOrder,
      summaryGroupOrder,
      groupLayout,
      summaryGroupLayout,
      palette
    }
  };
}

function refreshWebMonitorStatusUi() {
      const statusEl = document.getElementById('webMonitorStatus');
      const openBtn = document.getElementById('webMonitorOpenBtn');
      const liveStatusEl = document.getElementById('liveStatusIndicator');
      const toggleBtn = document.getElementById('webMonitorToggleBtn');
      if (liveStatusEl) {
        liveStatusEl.style.display = webMonitorRuntime.running ? 'flex' : 'none';
      }

      // Update header toggle button
      if (toggleBtn) {
        const openIcon = toggleBtn.querySelector('.web-monitor-open-icon');
        toggleBtn.classList.remove('disabled', 'enabled', 'running');
        if (webMonitorRuntime.running) {
          toggleBtn.classList.add('enabled', 'running');
          toggleBtn.querySelector('.web-monitor-toggle-text').textContent = `Web: ${webMonitorRuntime.host}:${webMonitorRuntime.port}`;
          if (openIcon) openIcon.style.display = 'inline-flex';
        } else {
          toggleBtn.classList.add('disabled');
          toggleBtn.querySelector('.web-monitor-toggle-text').textContent = 'Web: Off';
          if (openIcon) openIcon.style.display = 'none';
        }
      }

      // Always hide the "Sharing" indicator - the header toggle button shows status instead
      if (liveStatusEl) {
        liveStatusEl.style.display = 'none';
      }

      if (!statusEl || !openBtn) return;


      const currentSettings = normalizeWebMonitorSettings(loadWebMonitorSettings());

      if (webMonitorRuntime.running) {
        statusEl.textContent = currentSettings.readOnlyApiMode
          ? `Running on ${webMonitorRuntime.host}:${webMonitorRuntime.port} (API-only mode)`
          : `Running on ${webMonitorRuntime.host}:${webMonitorRuntime.port}`;
        statusEl.classList.remove('web-status-error');
        statusEl.classList.add('web-status-running');
        const primaryUrl = webMonitorRuntime.urls[0] || '';
        openBtn.disabled = !primaryUrl;
      } else {
        statusEl.textContent = webMonitorRuntime.error ? `Error: ${webMonitorRuntime.error}` : 'Stopped';
        statusEl.classList.remove('web-status-running');
        statusEl.classList.toggle('web-status-error', !!webMonitorRuntime.error);
        openBtn.disabled = true;
      }
    }

function openWebMonitorInBrowser() {
  const targetUrl = webMonitorRuntime.urls[0];
  if (!targetUrl) return;
  shell.openExternal(buildWebMonitorOpenUrl(targetUrl, loadWebMonitorSettings()));
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
    const getRequestToken = (reqUrl, req) => {
      const queryToken = String(reqUrl.searchParams.get('token') || '').trim();
      if (queryToken) return queryToken;
      const headerToken = String(req.headers['x-sir-token'] || '').trim();
      if (headerToken) return headerToken;
      const authHeader = String(req.headers.authorization || '').trim();
      const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
      if (bearerMatch && bearerMatch[1]) return String(bearerMatch[1]).trim();
      return '';
    };

    const isAuthorized = (reqUrl, req) => {
      if (!settings.requireAuth) return true;
      if (!settings.authToken) return false;
      const supplied = getRequestToken(reqUrl, req);
      return supplied === settings.authToken;
    };

    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url || '/', 'http://localhost');

      if (!isAuthorized(reqUrl, req)) {
        const wantsJson = reqUrl.pathname.startsWith('/api/');
        res.writeHead(401, { 'Content-Type': wantsJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8' });
        res.end(wantsJson ? JSON.stringify({ error: 'Unauthorized' }) : 'Unauthorized');
        return;
      }

      if (reqUrl.pathname === '/api/session/reset') {
        if (settings.readOnlyApiMode) {
          res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Read-only API mode is enabled' }));
          return;
        }
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', Allow: 'POST' });
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }
        resetSensorSessionStatistics();
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate'
        });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (reqUrl.pathname === '/api/monitor') {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate'
        });
        res.end(JSON.stringify(latestWebPayload));
        return;
      }

      if (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html') {
        if (settings.readOnlyApiMode) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Read-only API mode is enabled. Use /api/monitor instead.');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store'
        });
        res.end(buildWebMonitorHtml(getRequestToken(reqUrl, req)));
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
  return { fps: [], cpu: [], gpu: [], ram: [], psu: [], fans: [], network: [], latency: [], drives: [], app: [], other: [] };
}

function countHardwareSensors(groupedSensors, enabledOnly = false) {
  return Object.entries(groupedSensors || {}).reduce((total, [group, sensors]) => {
    if (group === 'app' || !Array.isArray(sensors)) return total;
    if (enabledOnly && sensorCategorySelection[group] === false) return total;
    return total + sensors.filter((sensor) => {
      if (!sensor || !sensor.id) return false;
      if (!enabledOnly) return true;
      return sensorSelection[sensor.id] === undefined
        ? sensor.defaultEnabled !== false
        : sensorSelection[sensor.id] === true;
    }).length;
  }, 0);
}

async function getAppRuntimeStats() {
  if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') return lastAppRuntimeStats;
  try {
    const stats = await ipcRenderer.invoke('app:get-runtime-stats');
    if (stats && typeof stats === 'object') lastAppRuntimeStats = stats;
  } catch (error) {
    // App telemetry is diagnostic only; a failed sample must never disrupt hardware updates.
  }
  return lastAppRuntimeStats;
}

function attachAppTelemetrySensors(groupedSensors, runtimeStats) {
  const grouped = groupedSensors && typeof groupedSensors === 'object'
    ? groupedSensors
    : createEmptyGroupedBuckets();
  grouped.app = buildAppTelemetrySensors(runtimeStats, {
    refreshIntervalMs: updateInterval,
    sensorReadDurationMs: lastSensorReadDurationMs,
    updateCycleDurationMs: lastUpdateCycleDurationMs,
    detectedSensorCount: countHardwareSensors(grouped, false),
    enabledSensorCount: countHardwareSensors(grouped, true),
    activeAlertCount: Object.values(activeSensorAlertState || {}).filter((state) => state && state.active === true).length,
    webConnectionCount: webMonitorSockets.size
  });
  return grouped;
}

function mergeAppTelemetryIntoCurrentSelection(runtimeStats) {
  const appOnly = attachAppTelemetrySensors(createEmptyGroupedBuckets(), runtimeStats);
  const cachedAppSignature = buildLiveSensorCatalogSignature({ app: cachedOrderedSensorCatalog.app || [] });
  const nextAppSignature = buildLiveSensorCatalogSignature({ app: appOnly.app || [] });
  if (cachedAppSignature !== nextAppSignature) {
    rebuildCachedSensorCatalog(appOnly, { preserveMissing: true });
  }

  const selectedApp = buildSelectedSensorsFromCachedCatalog(appOnly, { preserveMissing: true }).app || [];
  latestSelectedGroupedSensors = {
    ...createEmptyGroupedBuckets(),
    ...(latestSelectedGroupedSensors || {}),
    app: selectedApp
  };
  return latestSelectedGroupedSensors;
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

function loadOverlaySensorSelection() {
  try {
    const raw = localStorage.getItem(SENSOR_OVERLAY_SELECTION_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveOverlaySensorSelection() {
  localStorage.setItem(SENSOR_OVERLAY_SELECTION_KEY, JSON.stringify(overlaySensorSelection));
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

function normalizeAlertOperator(op) {
  const value = String(op || '').trim();
  return ['>=', '>', '<=', '<'].includes(value) ? value : '>=';
}

function normalizeAlertSeverity(severity) {
  const value = String(severity || '').trim().toLowerCase();
  return value === 'critical' ? 'critical' : 'warning';
}

function normalizeSensorAlertRule(input) {
  const threshold = Number(input?.threshold);
  const cooldownSec = Number(input?.cooldownSec);
  return {
    enabled: input?.enabled !== false,
    operator: normalizeAlertOperator(input?.operator),
    threshold: Number.isFinite(threshold) ? threshold : 0,
    cooldownSec: Number.isFinite(cooldownSec) ? Math.max(1, Math.min(3600, Math.round(cooldownSec))) : 30,
    severity: normalizeAlertSeverity(input?.severity)
  };
}

function normalizeSensorAlertRules(input) {
  if (!input || typeof input !== 'object') return {};
  const out = {};
  Object.entries(input).forEach(([sensorId, rule]) => {
    const key = String(sensorId || '').trim();
    if (!key || !rule || typeof rule !== 'object') return;
    out[key] = normalizeSensorAlertRule(rule);
  });
  return out;
}

function loadSensorAlertRules() {
  try {
    const raw = localStorage.getItem(SENSOR_ALERT_RULES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return normalizeSensorAlertRules(parsed);
  } catch (e) {
    return {};
  }
}

function saveSensorAlertRules() {
  localStorage.setItem(SENSOR_ALERT_RULES_KEY, JSON.stringify(normalizeSensorAlertRules(sensorAlertRules)));
}

function shouldAlertTrigger(operator, value, threshold) {
  if (!Number.isFinite(value) || !Number.isFinite(threshold)) return false;
  if (operator === '>') return value > threshold;
  if (operator === '>=') return value >= threshold;
  if (operator === '<') return value < threshold;
  if (operator === '<=') return value <= threshold;
  return false;
}

function getDefaultAlertRuleForSensor(sensor) {
  const name = String(sensor?.name || '').toLowerCase();
  const units = String(sensor?.units || '').toLowerCase();

  if (name.includes('temp') || units.includes('°c') || units.includes('c') || units.includes('°f') || units.includes('f')) {
    const isF = currentTemperatureUnit === 'f' || units.includes('°f');
    return { enabled: true, operator: '>=', threshold: isF ? 176 : 80, cooldownSec: 30, severity: 'critical' };
  }
  if (units.includes('%') || name.includes('usage') || name.includes('util') || name.includes('load')) {
    return { enabled: true, operator: '>=', threshold: 90, cooldownSec: 30, severity: 'warning' };
  }
  if (units.includes('rpm') || name.includes('fan')) {
    return { enabled: true, operator: '<=', threshold: 500, cooldownSec: 30, severity: 'warning' };
  }
  return { enabled: true, operator: '>=', threshold: 90, cooldownSec: 30, severity: 'warning' };
}

function evaluateSensorAlerts(groupedSensors) {
  const state = {};
  const now = Date.now();
  Object.keys(groupedSensors || {}).forEach((group) => {
    (groupedSensors[group] || []).forEach((sensor) => {
      const sensorId = String(sensor?.id || '').trim();
      if (!sensorId) return;
      const rawRule = sensorAlertRules[sensorId];
      if (!rawRule) return;
      const rule = normalizeSensorAlertRule(rawRule);
      if (!rule.enabled) return;
      const rawValue = Number(sensor.value);
      if (!Number.isFinite(rawValue)) return;
      const normalized = normalizeValueForDisplay(sensor, rawValue);
      const value = Number(normalized?.value);
      if (!Number.isFinite(value)) return;

      const breached = shouldAlertTrigger(rule.operator, value, rule.threshold);
      if (!breached) return;

      const lastAt = Number(sensorAlertLastTriggeredAt[sensorId] || 0);
      const cooldownMs = Math.max(1000, rule.cooldownSec * 1000);
      if ((now - lastAt) >= cooldownMs) {
        sensorAlertLastTriggeredAt[sensorId] = now;
      }

      state[sensorId] = {
        active: true,
        severity: rule.severity,
        value,
        threshold: rule.threshold,
        operator: rule.operator
      };
    });
  });
  activeSensorAlertState = state;
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
    const existing = Array.isArray(sensorOrderByGroup[group]) ? sensorOrderByGroup[group] : [];
    const existingSet = new Set(existing);
    const missing = availableIds.filter((id) => !existingSet.has(id));
    const next = [...existing, ...missing];

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

function moveSensorOrderByDrop(group, sensorId, targetSensorId, placeAfter, visibleSensorIds) {
  if (!group || !sensorId || !targetSensorId || sensorId === targetSensorId) return;

  const list = Array.isArray(sensorOrderByGroup[group]) ? [...sensorOrderByGroup[group]] : [];
  const next = reorderVisibleSensors(list, sensorId, targetSensorId, placeAfter, visibleSensorIds);
  if (JSON.stringify(next) === JSON.stringify(list)) return;

  sensorOrderByGroup[group] = next;
  saveSensorOrder();
  sensorCatalogSignature = '';
  liveSensorCatalogSignature = '';
  updateStats();
}

function loadProviderSelection() {
  try {
    const raw = localStorage.getItem(PROVIDER_SELECTION_KEY);
    if (!raw) {
      return { builtin: true, enhanced: false, rtss: false, aida64: false, hwinfo: false };
    }
    const parsed = raw ? JSON.parse(raw) : {};
    if (!Object.prototype.hasOwnProperty.call(parsed, 'builtin')) {
      return { builtin: true, enhanced: false, rtss: false, aida64: false, hwinfo: false };
    }
    return {
      builtin: parsed.builtin !== false,
      enhanced: parsed.enhanced === true,
      rtss: parsed.rtss === true,
      aida64: parsed.aida64 === true,
      hwinfo: parsed.hwinfo === true
    };
  } catch (e) {
    return { builtin: true, enhanced: false, rtss: false, aida64: false, hwinfo: false };
  }
}

function saveProviderSelection(selection) {
  localStorage.setItem(PROVIDER_SELECTION_KEY, JSON.stringify(selection));
}

function showEnhancedSensorsConfirmation() {
  const modal = document.getElementById('enhancedSensorsConfirmModal');
  const confirmButton = document.getElementById('confirmEnhancedSensorsBtn');
  const cancelButtons = modal ? Array.from(modal.querySelectorAll('[data-cancel-enhanced-sensors]')) : [];
  if (!modal || !confirmButton || !cancelButtons.length) return Promise.resolve(false);

  const previousFocus = document.activeElement;
  setModalShellVisible(modal, true);

  return new Promise((resolve) => {
    let settled = false;

    const finish = (accepted) => {
      if (settled) return;
      settled = true;
      setModalShellVisible(modal, false);
      confirmButton.removeEventListener('click', accept);
      cancelButtons.forEach((button) => button.removeEventListener('click', cancel));
      modal.removeEventListener('click', cancelFromBackdrop);
      document.removeEventListener('keydown', cancelFromEscape, true);
      if (!accepted && previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
      resolve(accepted);
    };

    const accept = () => finish(true);
    const cancel = () => finish(false);
    const cancelFromBackdrop = (event) => {
      if (event.target === modal) cancel();
    };
    const cancelFromEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    };

    confirmButton.addEventListener('click', accept);
    cancelButtons.forEach((button) => button.addEventListener('click', cancel));
    modal.addEventListener('click', cancelFromBackdrop);
    document.addEventListener('keydown', cancelFromEscape, true);
    requestAnimationFrame(() => confirmButton.focus());
  });
}

function queueWebMonitorRuntimeState(settingsInput) {
  const requestedSettings = normalizeWebMonitorSettings(settingsInput || loadWebMonitorSettings());
  webMonitorDesiredEnabled = requestedSettings.enabled;

  webMonitorLifecycleQueue = webMonitorLifecycleQueue
    .catch((error) => {
      console.error('Previous Web Monitor transition failed:', error);
    })
    .then(async () => {
      if (!requestedSettings.enabled) {
        await stopWebMonitorServer();
        return true;
      }

      const started = await startWebMonitorServer(requestedSettings);
      if (!started && webMonitorDesiredEnabled === requestedSettings.enabled) {
        // A failed start is not an active target. This lets the header button
        // retry even when the saved Enable Browser View checkbox remains on.
        webMonitorDesiredEnabled = false;
      }
      return started;
    });

  return webMonitorLifecycleQueue;
}

function getWindowOrderStorageKey(mode = getCurrentLayoutMode()) {
  return normalizeLayoutMode(mode) === 'summary' ? SUMMARY_WINDOW_ORDER_KEY : WINDOW_ORDER_KEY;
}

function loadWindowOrder(mode = getCurrentLayoutMode()) {
  try {
    const key = getWindowOrderStorageKey(mode);
    let raw = localStorage.getItem(key);
    if (raw === null && key === SUMMARY_WINDOW_ORDER_KEY) {
      // Seed Summary Mode from the user's existing dashboard order once, then
      // save future Summary drag changes under its own independent key.
      raw = localStorage.getItem(WINDOW_ORDER_KEY);
    }
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveWindowOrder(order, mode = getCurrentLayoutMode()) {
  localStorage.setItem(getWindowOrderStorageKey(mode), JSON.stringify(order || []));
}

function normalizeLayoutMode(mode) {
  return String(mode || '').toLowerCase() === 'summary' ? 'summary' : 'normal';
}

function getCurrentLayoutMode() {
  return summaryModeEnabled ? 'summary' : 'normal';
}

function getLayoutStorageKeys(mode = getCurrentLayoutMode()) {
  const normalizedMode = normalizeLayoutMode(mode);
  return normalizedMode === 'summary'
    ? {
        mode: normalizedMode,
        preset: SUMMARY_LAYOUT_PRESET_KEY,
        config: SUMMARY_CUSTOM_LAYOUT_CONFIG_KEY,
        customSizes: SUMMARY_CUSTOM_LAYOUT_SIZES_KEY,
        sizes: SUMMARY_WINDOW_SIZE_KEY
      }
    : {
        mode: normalizedMode,
        preset: LAYOUT_PRESET_KEY,
        config: CUSTOM_LAYOUT_CONFIG_KEY,
        customSizes: CUSTOM_LAYOUT_SIZES_KEY,
        sizes: WINDOW_SIZE_KEY
      };
}

function getSelectedLayoutPreset(mode = getCurrentLayoutMode()) {
  const keys = getLayoutStorageKeys(mode);
  return normalizeLayoutPreset(localStorage.getItem(keys.preset) || DEFAULT_LAYOUT_PRESET);
}

function loadWindowSizes(mode = getCurrentLayoutMode()) {
  const keys = getLayoutStorageKeys(mode);
  try {
    const raw = localStorage.getItem(keys.sizes);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveWindowSizes(sizeMap, mode = getCurrentLayoutMode()) {
  const keys = getLayoutStorageKeys(mode);
  const normalized = sizeMap && typeof sizeMap === 'object' && !Array.isArray(sizeMap) ? sizeMap : {};
  const serialized = JSON.stringify(normalized);
  localStorage.setItem(keys.sizes, serialized);
  if (getSelectedLayoutPreset(keys.mode) === 'custom') {
    localStorage.setItem(keys.customSizes, serialized);
  }
}

function loadCustomLayoutSizes(mode = getCurrentLayoutMode()) {
  const keys = getLayoutStorageKeys(mode);
  try {
    const raw = localStorage.getItem(keys.customSizes);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

function saveCustomLayoutSizes(sizeMap, mode = getCurrentLayoutMode()) {
  const keys = getLayoutStorageKeys(mode);
  const normalized = sizeMap && typeof sizeMap === 'object' && !Array.isArray(sizeMap) ? sizeMap : {};
  localStorage.setItem(keys.customSizes, JSON.stringify(normalized));
}

function normalizeCustomLayoutConfig(config, fallbackPresetId = DEFAULT_LAYOUT_PRESET) {
  const fallbackId = normalizeLayoutPreset(fallbackPresetId) === 'custom' ? DEFAULT_LAYOUT_PRESET : normalizeLayoutPreset(fallbackPresetId);
  const fallback = getLayoutPreset(fallbackId);
  const source = config && typeof config === 'object' ? config : {};
  const defaultCardWidth = Math.min(1200, Math.max(180, Number(source.defaultCardWidth) || Number(source.minCardWidth) || fallback.minCardWidth));
  return {
    id: 'custom',
    label: 'Custom',
    minCardWidth: 180,
    defaultCardWidth,
    cardHeight: Math.min(900, Math.max(220, Number(source.cardHeight) || fallback.cardHeight)),
    gap: Math.min(40, Math.max(0, Number(source.gap) || fallback.gap)),
    stacked: false,
    custom: true
  };
}

function loadCustomLayoutConfig(fallbackPresetId = DEFAULT_LAYOUT_PRESET, mode = getCurrentLayoutMode()) {
  const keys = getLayoutStorageKeys(mode);
  try {
    const raw = localStorage.getItem(keys.config);
    const parsed = raw ? JSON.parse(raw) : null;
    return normalizeCustomLayoutConfig(parsed, fallbackPresetId);
  } catch (e) {
    return normalizeCustomLayoutConfig(null, fallbackPresetId);
  }
}

function saveCustomLayoutConfig(config, fallbackPresetId = DEFAULT_LAYOUT_PRESET, mode = getCurrentLayoutMode()) {
  const keys = getLayoutStorageKeys(mode);
  const normalized = normalizeCustomLayoutConfig(config, fallbackPresetId);
  localStorage.setItem(keys.config, JSON.stringify(normalized));
  return normalized;
}

function getActiveLayoutConfig(presetId, mode = getCurrentLayoutMode()) {
  const normalized = normalizeLayoutPreset(presetId);
  return normalized === 'custom' ? loadCustomLayoutConfig(DEFAULT_LAYOUT_PRESET, mode) : getLayoutPreset(normalized);
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

function updateSettingsAccordionState(key, expanded) {
  const state = loadSettingsAccordionState();
  state[String(key || '')] = !!expanded;
  saveSettingsAccordionState(state);
}

function isSetupGuideSuppressed() {
  return localStorage.getItem(SETUP_GUIDE_SUPPRESS_KEY) === 'true';
}

function setSetupGuideSuppressed(suppressed) {
  localStorage.setItem(SETUP_GUIDE_SUPPRESS_KEY, suppressed ? 'true' : 'false');
}

function setModalShellVisible(modal, visible) {
  if (!modal) return;
  modal.classList.toggle('is-hidden', !visible);
  modal.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

let activeThemedDialog = null;

function showThemedDialog(options = {}) {
  const modal = document.getElementById('themedDialogModal');
  const dialog = modal?.querySelector('.themed-dialog');
  const title = document.getElementById('themedDialogTitleText');
  const icon = document.getElementById('themedDialogIcon');
  const message = document.getElementById('themedDialogMessage');
  const detail = document.getElementById('themedDialogDetail');
  const closeButton = document.getElementById('themedDialogCloseBtn');
  const cancelButton = document.getElementById('themedDialogCancelBtn');
  const confirmButton = document.getElementById('themedDialogConfirmBtn');
  if (!modal || !dialog || !title || !icon || !message || !detail || !closeButton || !cancelButton || !confirmButton) {
    return Promise.resolve(options.showCancel ? false : true);
  }

  if (activeThemedDialog && typeof activeThemedDialog.finish === 'function') {
    activeThemedDialog.finish(false);
  }

  const showCancel = options.showCancel === true;
  const previousFocus = document.activeElement;
  title.textContent = String(options.title || 'SiR System Monitor');
  message.textContent = String(options.message || '');
  icon.className = `bi ${String(options.icon || 'bi-info-circle-fill')} themed-dialog-icon`;
  dialog.classList.remove('is-success', 'is-warning', 'is-error');
  dialog.classList.add(`is-${String(options.tone || 'info')}`);
  confirmButton.textContent = String(options.confirmLabel || 'OK');
  cancelButton.textContent = String(options.cancelLabel || 'Cancel');
  cancelButton.hidden = !showCancel;

  const detailText = String(options.detail || '').trim();
  detail.hidden = !detailText;
  detail.replaceChildren();
  if (detailText) {
    const detailIcon = document.createElement('i');
    detailIcon.className = `bi ${String(options.detailIcon || 'bi-info-circle-fill')}`;
    detailIcon.setAttribute('aria-hidden', 'true');
    const detailCopy = document.createElement('span');
    detailCopy.textContent = detailText;
    detail.append(detailIcon, detailCopy);
  }

  setModalShellVisible(modal, true);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (accepted) => {
      if (settled) return;
      settled = true;
      setModalShellVisible(modal, false);
      confirmButton.removeEventListener('click', accept);
      cancelButton.removeEventListener('click', cancel);
      closeButton.removeEventListener('click', cancel);
      modal.removeEventListener('click', cancelFromBackdrop);
      document.removeEventListener('keydown', cancelFromEscape);
      if (activeThemedDialog?.finish === finish) activeThemedDialog = null;
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
      resolve(accepted);
    };
    const accept = () => finish(true);
    const cancel = () => finish(false);
    const cancelFromBackdrop = (event) => {
      if (event.target === modal) cancel();
    };
    const cancelFromEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancel();
    };

    activeThemedDialog = { finish };
    confirmButton.addEventListener('click', accept);
    cancelButton.addEventListener('click', cancel);
    closeButton.addEventListener('click', cancel);
    modal.addEventListener('click', cancelFromBackdrop);
    document.addEventListener('keydown', cancelFromEscape);
    requestAnimationFrame(() => confirmButton.focus());
  });
}

function showThemedMessage(title, message, options = {}) {
  return showThemedDialog({
    ...options,
    title,
    message,
    showCancel: false,
    confirmLabel: options.confirmLabel || 'OK'
  });
}

function showThemedConfirmation(title, message, options = {}) {
  return showThemedDialog({
    ...options,
    title,
    message,
    showCancel: true,
    confirmLabel: options.confirmLabel || 'Continue',
    cancelLabel: options.cancelLabel || 'Cancel'
  });
}

function setSetupGuideModalVisible(visible) {
  const modal = document.getElementById('setupGuideModal');
  setModalShellVisible(modal, visible);
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

function setDiagnosticsModalVisible(visible) {
  const modal = document.getElementById('diagnosticsModal');
  if (!modal) return;
  setModalShellVisible(modal, visible);
  if (visible) {
    const firstTest = modal.querySelector('.diagnostics-test-card:not(:disabled)');
    if (firstTest) firstTest.focus();
  }
}

function buildSupportBundlePayload(diagnosticsText = '') {
  const settings = buildSettingsSnapshot();
  delete settings[SENSOR_CUSTOM_NAMES_KEY];
  delete settings[LATENCY_HOST_KEY];
  try {
    const webSettings = JSON.parse(settings[WEB_MONITOR_SETTINGS_KEY] || '{}');
    settings[WEB_MONITOR_SETTINGS_KEY] = {
      ...webSettings,
      host: '[redacted]',
      authToken: '[redacted]'
    };
  } catch (error) {
    settings[WEB_MONITOR_SETTINGS_KEY] = '[redacted]';
  }

  const sensorCatalog = {};
  SENSOR_GROUP_ORDER.forEach((group) => {
    sensorCatalog[group] = (cachedOrderedSensorCatalog[group] || []).map((sensor) => ({
      id: String(sensor.id || ''),
      name: String(sensor.name || ''),
      units: String(sensor.units || ''),
      source: String(sensor.source || sensor.provider || ''),
      enabled: sensorSelection[sensor.id] === true,
      overlay: overlaySensorSelection[sensor.id] === true
    }));
  });

  const providers = loadProviderSelection();
  return {
    diagnostics: String(diagnosticsText || ''),
    settings,
    sensorCatalog,
    runtime: {
      appVersion: APP_VERSION,
      generatedAt: new Date().toISOString(),
      summaryMode: summaryModeEnabled,
      monitoringMode: document.body.classList.contains('monitoring-mode'),
      theme: localStorage.getItem('theme') || 'blue',
      animationSettings: loadAnimationSettings(),
      providers: {
        builtin: providers.builtin === true,
        enhanced: providers.enhanced === true,
        rtss: providers.rtss === true,
        aida64: providers.aida64 === true,
        hwinfo: providers.hwinfo === true
      },
      selectedSensorCount: Object.values(sensorSelection).filter(Boolean).length,
      overlaySensorCount: Object.values(overlaySensorSelection).filter(Boolean).length,
      webMonitorRunning: webMonitorRuntime.running === true,
      webMonitorConnections: Math.max(0, Number(webMonitorRuntime.connections) || 0)
    }
  };
}

function initializeDiagnosticsModal() {
  const modal = document.getElementById('diagnosticsModal');
  const openButton = document.getElementById('diagnosticsHeaderBtn');
  if (!modal || modal.dataset.initialized === 'true') return;
  modal.dataset.initialized = 'true';

  const output = document.getElementById('diagnosticsOutput');
  const status = document.getElementById('diagnosticsStatus');
  const statusWrap = modal.querySelector('.diagnostics-status-wrap');
  const cancelButton = document.getElementById('diagnosticsCancelBtn');
  const copyButton = document.getElementById('diagnosticsCopyBtn');
  const bundleButton = document.getElementById('diagnosticsBundleBtn');
  const clearButton = document.getElementById('diagnosticsClearBtn');
  const testButtons = Array.from(modal.querySelectorAll('[data-diagnostic-id]'));
  let activeRunId = '';
  let diagnosticRunning = false;
  let bundleCreating = false;
  let diagnosticCompletionWaiter = null;
  const pendingDiagnosticCompletions = new Map();

  const appendOutput = (text) => {
    if (!output || !text) return;
    output.value += String(text);
    if (output.value.length > 1024 * 1024) {
      output.value = `${output.value.slice(0, 1024 * 1024)}\n[Combined output limited to 1 MB.]\n`;
    }
    output.scrollTop = output.scrollHeight;
  };

  const setStatus = (message, state = '') => {
    if (status) status.textContent = message;
    if (statusWrap) {
      statusWrap.classList.remove('is-running', 'is-success', 'is-error');
      if (state) statusWrap.classList.add(`is-${state}`);
    }
  };

  const refreshControls = () => {
    const busy = diagnosticRunning || bundleCreating;
    testButtons.forEach((button) => { button.disabled = busy; });
    if (cancelButton) cancelButton.disabled = !diagnosticRunning;
    if (bundleButton) bundleButton.disabled = busy;
    if (clearButton) clearButton.disabled = busy;
  };

  const setRunning = (running) => {
    diagnosticRunning = !!running;
    refreshControls();
  };

  const setBundleCreating = (creating) => {
    bundleCreating = !!creating;
    refreshControls();
  };

  const finishImmediateDiagnostic = (label, success, error = '') => {
    activeRunId = '';
    setRunning(false);
    if (success) {
      appendOutput(`\n[${label} completed successfully.]\n`);
      setStatus(`${label} completed.`, 'success');
    } else {
      appendOutput(`\n[${label} failed: ${error || 'Unknown error'}]\n`);
      setStatus(`${label} failed.`, 'error');
    }
    return { success: !!success, cancelled: false, timedOut: false, error: success ? '' : error };
  };

  const presentDiagnosticCompletion = (payload = {}) => {
    const label = String(payload.label || 'Diagnostic');
    activeRunId = '';
    setRunning(false);
    if (payload.cancelled === true) {
      appendOutput(`\n[${label} cancelled.]\n`);
      setStatus(`${label} cancelled.`, 'error');
    } else if (payload.timedOut === true) {
      appendOutput(`\n[${label} timed out.]\n`);
      setStatus(`${label} timed out.`, 'error');
    } else if (payload.success === true) {
      appendOutput(`\n[${label} completed successfully.]\n`);
      setStatus(`${label} completed.`, 'success');
    } else {
      const detail = payload.error || `exit code ${payload.exitCode ?? 'unknown'}`;
      appendOutput(`\n[${label} failed: ${detail}]\n`);
      setStatus(`${label} failed.`, 'error');
    }
    return {
      success: payload.success === true,
      cancelled: payload.cancelled === true,
      timedOut: payload.timedOut === true,
      error: String(payload.error || ''),
      exitCode: payload.exitCode ?? null
    };
  };

  const runDiagnosticAndWait = async (diagnosticId, label, progress = null) => {
    const separator = output && output.value.trim() ? '\n\n' : '';
    appendOutput(`${separator}================================================================\n${label}\nStarted: ${new Date().toISOString()}\n================================================================\n`);
    setRunning(true);
    setStatus(progress || `Running ${label}...`, 'running');

    try {
      const result = await ipcRenderer.invoke('diagnostics:run', diagnosticId);
      if (!result || result.ok !== true) {
        return finishImmediateDiagnostic(label, false, result?.error || 'Unable to start diagnostic.');
      }
      if (result.immediate === true) {
        appendOutput(`${String(result.output || '').trim()}\n`);
        return finishImmediateDiagnostic(label, true);
      }

      activeRunId = String(result.runId || '');
      const queuedCompletion = pendingDiagnosticCompletions.get(activeRunId);
      if (queuedCompletion) {
        pendingDiagnosticCompletions.delete(activeRunId);
        activeRunId = '';
        return queuedCompletion;
      }

      if (!activeRunId) {
        return finishImmediateDiagnostic(label, false, 'The diagnostic runner did not return a run identifier.');
      }

      return await new Promise((resolve) => {
        diagnosticCompletionWaiter = { runId: activeRunId, resolve };
      });
    } catch (error) {
      return finishImmediateDiagnostic(label, false, error.message);
    }
  };

  testButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      if (diagnosticRunning || bundleCreating) return;
      const diagnosticId = String(button.dataset.diagnosticId || '').trim();
      const label = String(button.querySelector('strong')?.textContent || 'Diagnostic').trim();
      if (!diagnosticId) return;
      await runDiagnosticAndWait(diagnosticId, label);
    });
  });

  ipcRenderer.on('diagnostics:output', (_event, payload = {}) => {
    if (!diagnosticRunning) return;
    appendOutput(String(payload.chunk || ''));
  });

  ipcRenderer.on('diagnostics:complete', (_event, payload = {}) => {
    if (!diagnosticRunning && !diagnosticCompletionWaiter) return;
    if (activeRunId && payload.runId && String(payload.runId) !== activeRunId) return;
    const runId = String(payload.runId || activeRunId || '');
    const completion = presentDiagnosticCompletion(payload);
    if (diagnosticCompletionWaiter && (!diagnosticCompletionWaiter.runId || diagnosticCompletionWaiter.runId === runId)) {
      const waiter = diagnosticCompletionWaiter;
      diagnosticCompletionWaiter = null;
      waiter.resolve(completion);
    } else if (runId) {
      pendingDiagnosticCompletions.set(runId, completion);
    }
  });

  cancelButton?.addEventListener('click', async () => {
    if (!diagnosticRunning) return;
    cancelButton.disabled = true;
    setStatus('Cancelling diagnostic...', 'running');
    try {
      const result = await ipcRenderer.invoke('diagnostics:cancel', activeRunId);
      if (!result || result.ok !== true) {
        cancelButton.disabled = false;
        setStatus(result?.error || 'Unable to cancel diagnostic.', 'error');
      }
    } catch (error) {
      cancelButton.disabled = false;
      setStatus(`Unable to cancel diagnostic: ${error.message}`, 'error');
    }
  });

  clearButton?.addEventListener('click', () => {
    if (output) output.value = '';
    if (!diagnosticRunning) setStatus('Results cleared. Ready to run a diagnostic.');
  });

  copyButton?.addEventListener('click', async () => {
    const text = String(output?.value || '');
    if (!text) {
      setStatus('There are no diagnostic results to copy.', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      output.focus();
      output.select();
      document.execCommand('copy');
      output.setSelectionRange(output.value.length, output.value.length);
    }
    setStatus('Diagnostic results copied to the clipboard.', 'success');
  });

  bundleButton?.addEventListener('click', async () => {
    if (diagnosticRunning || bundleCreating) return;
    const accepted = await showThemedConfirmation(
      'Create Support Bundle?',
      'SiR System Monitor will automatically run all six read-only diagnostic checks before creating the support bundle. The checks run one at a time and can take about a minute, or longer on slower systems.',
      {
        icon: 'bi-file-earmark-zip-fill',
        tone: 'warning',
        confirmLabel: 'Run 6 Tests & Continue',
        cancelLabel: 'Cancel',
        detailIcon: 'bi-activity',
        detail: 'The current results box will be cleared. Each test result—including failures or timeouts—will be added to the privacy-scrubbed ZIP. You can cancel while a check is running.'
      }
    );
    if (!accepted) {
      setStatus('Support bundle creation cancelled.');
      return;
    }

    setBundleCreating(true);
    if (output) output.value = '';
    appendOutput(`SUPPORT BUNDLE DIAGNOSTIC SUITE\nStarted: ${new Date().toISOString()}\nChecks scheduled: ${testButtons.length}\n`);
    try {
      const results = [];
      for (let index = 0; index < testButtons.length; index += 1) {
        const button = testButtons[index];
        const diagnosticId = String(button.dataset.diagnosticId || '').trim();
        const label = String(button.querySelector('strong')?.textContent || 'Diagnostic').trim();
        const result = await runDiagnosticAndWait(
          diagnosticId,
          label,
          `Support bundle: running check ${index + 1} of ${testButtons.length} — ${label}...`
        );
        results.push({ diagnosticId, label, ...result });
        if (result.cancelled) {
          appendOutput(`\nSUPPORT BUNDLE SUITE CANCELLED\nCompleted checks: ${results.length} of ${testButtons.length}\n`);
          setStatus('Support bundle suite cancelled. No bundle was created.', 'error');
          return;
        }
      }

      const passed = results.filter((result) => result.success).length;
      const issues = results.length - passed;
      appendOutput(`\n================================================================\nSUPPORT BUNDLE SUITE COMPLETE\nFinished: ${new Date().toISOString()}\nChecks attempted: ${results.length}\nPassed: ${passed}\nFailed or timed out: ${issues}\n================================================================\n`);
      setStatus('All six checks finished. Choose where to save the support bundle...', 'running');
      const result = await ipcRenderer.invoke('diagnostics:create-support-bundle', buildSupportBundlePayload(output?.value || ''));
      if (result?.canceled === true) {
        setStatus('The six checks completed, but support bundle saving was cancelled.');
      } else if (result?.ok === true) {
        setStatus(`Support bundle created: ${result.filePath}`, 'success');
      } else {
        setStatus(result?.error || 'Unable to create the support bundle.', 'error');
      }
    } catch (error) {
      setStatus(`Unable to create the support bundle: ${error.message}`, 'error');
    } finally {
      setBundleCreating(false);
    }
  });

  openButton?.addEventListener('click', () => setDiagnosticsModalVisible(true));
  modal.querySelectorAll('[data-close-diagnostics]').forEach((button) => {
    button.addEventListener('click', () => setDiagnosticsModalVisible(false));
  });
  modal.addEventListener('click', (event) => {
    if (event.target === modal) setDiagnosticsModalVisible(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.classList.contains('is-hidden')) {
      setDiagnosticsModalVisible(false);
    }
  });
}

function setImportSettingsModalVisible(visible) {
  const modal = document.getElementById('importSettingsModal');
  setModalShellVisible(modal, visible);
}

function normalizeProfileName(name) {
  const text = String(name || '').trim();
  return text.slice(0, 64);
}

function loadSettingsProfiles() {
  try {
    const raw = localStorage.getItem(SETTINGS_PROFILES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (e) {
    return {};
  }
}

function saveSettingsProfiles(profiles) {
  try {
    localStorage.setItem(SETTINGS_PROFILES_KEY, JSON.stringify(profiles || {}));
  } catch (e) {}
}

function buildSettingsSnapshot() {
  const payload = {};
  SETTINGS_SNAPSHOT_KEYS.forEach((k) => {
    try {
      payload[k] = localStorage.getItem(k);
    } catch (e) {
      payload[k] = null;
    }
  });
  try {
    payload[SENSOR_ORDER_KEY] = JSON.stringify(sensorOrderByGroup || {});
  } catch (e) {}
  return payload;
}

function normalizeEnhancedAdministratorSnapshot(snapshot) {
  const normalized = snapshot && typeof snapshot === 'object' ? { ...snapshot } : {};
  try {
    const providerRaw = normalized[PROVIDER_SELECTION_KEY];
    const providers = typeof providerRaw === 'string' ? JSON.parse(providerRaw) : providerRaw;
    if (!providers || providers.enhanced !== true) return normalized;

    const behaviorRaw = normalized[APP_BEHAVIOR_SETTINGS_KEY];
    const behavior = typeof behaviorRaw === 'string' ? JSON.parse(behaviorRaw) : behaviorRaw;
    normalized[APP_BEHAVIOR_SETTINGS_KEY] = JSON.stringify(normalizeAppBehaviorSettings({
      ...(behavior && typeof behavior === 'object' ? behavior : DEFAULT_APP_BEHAVIOR_SETTINGS),
      launchAsAdministrator: true
    }));
  } catch (error) {
    // Keep malformed legacy data unchanged; normal import validation will handle it.
  }
  return normalized;
}

function settingsSnapshotMatchesCurrent(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const current = buildSettingsSnapshot();
  return Object.keys(snapshot).every((key) => {
    const expected = snapshot[key];
    const actual = Object.prototype.hasOwnProperty.call(current, key) ? current[key] : localStorage.getItem(key);
    if (expected === null || expected === undefined) return actual === null || actual === undefined;
    return String(actual) === String(expected);
  });
}

async function persistCrossProcessSettingsFromSnapshot(parsed) {
  try {
    if (parsed && parsed[APP_BEHAVIOR_SETTINGS_KEY]) {
      const raw = parsed[APP_BEHAVIOR_SETTINGS_KEY];
      const behavior = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (behavior && typeof behavior === 'object') {
        await setAppBehaviorSettings(behavior);
      }
    }
  } catch (e) {
    console.warn('Failed to persist app behavior from snapshot:', e);
  }
}

async function prepareSensorCollectorForReload() {
  updateLoopActive = false;
  clearTimeout(updateTimer);
  if (sensorReader && typeof sensorReader.close === 'function') {
    await sensorReader.close({ forceAfterMs: 2000 });
  }
}

function closeImportSettingsModal() {
  setImportSettingsModalVisible(false);
}

async function applyImportedSettingsNow() {
  const modal = document.getElementById('importSettingsModal');
  if (!modal) return;
  let parsed = {};
  try { parsed = JSON.parse(modal.dataset.parsed || '{}'); } catch (e) { parsed = {}; }
  parsed = normalizeEnhancedAdministratorSnapshot(parsed);

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
    ThemeManager.setTheme(
      parsed.theme ? String(parsed.theme).replace(/^"|"$/g, '') : ThemeManager.getTheme(),
      { persist: false, updatePalettes: false }
    );
    DisplayModeManager.apply(
      parsed[DISPLAY_MODE_KEY] ? String(parsed[DISPLAY_MODE_KEY]).replace(/^"|"$/g, '') : getDisplayModePreference(),
      { persist: false }
    );
  } catch (e) {}
  try {
    if (!parsed[CUSTOM_COLOR_PALETTES_KEY] && parsed[CUSTOM_COLORS_KEY]) {
      const raw = parsed[ CUSTOM_COLORS_KEY ];
      let colors = null;
      try { colors = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { colors = null; }
      if (colors) {
        localStorage.removeItem(CUSTOM_COLOR_PALETTES_KEY);
        CustomColorManager.saveColors(colors, 'dark');
        DisplayModeManager.apply(getDisplayModePreference(), { persist: false });
      }
    }
  } catch (e) {}

  try { if (parsed[VIEW_MODE_KEY]) applyViewMode(String(parsed[VIEW_MODE_KEY]).replace(/^"|"$/g, ''), { persist: true }); } catch (e) {}
  try {
    if (Object.prototype.hasOwnProperty.call(parsed, LAYOUT_PRESET_KEY)) {
      applyLayoutPreset(parsed[LAYOUT_PRESET_KEY] || DEFAULT_LAYOUT_PRESET, { mode: 'normal', persist: true, resetCustomSizes: false });
    }
  } catch (e) {}
  try {
    if (Object.prototype.hasOwnProperty.call(parsed, SUMMARY_LAYOUT_PRESET_KEY)) {
      applyLayoutPreset(parsed[SUMMARY_LAYOUT_PRESET_KEY] || DEFAULT_LAYOUT_PRESET, { mode: 'summary', persist: true, resetCustomSizes: false });
    }
  } catch (e) {}
  try { applyWindowOrder(); applyWindowSizes(); } catch (e) {}
  try { if (parsed[FONT_SIZE_KEY]) applyFontSize(String(parsed[FONT_SIZE_KEY]).replace(/^"|"$/g, '')); } catch (e) {}
  try { const fontSizeSelect = document.getElementById('fontSizeSelect'); if (fontSizeSelect && parsed[FONT_SIZE_KEY]) fontSizeSelect.value = String(parsed[FONT_SIZE_KEY]).replace(/^"|"$/g, ''); } catch (e) {}
  try { if (parsed[FONT_FAMILY_KEY]) applyFontFamily(String(parsed[FONT_FAMILY_KEY]).replace(/^"|"$/g, '')); } catch (e) {}
  try { const fontFamilySelect = document.getElementById('fontFamilySelect'); if (fontFamilySelect && parsed[FONT_FAMILY_KEY]) fontFamilySelect.value = String(parsed[FONT_FAMILY_KEY]).replace(/^"|"$/g, ''); } catch (e) {}
  try { if (parsed[VALUE_FONT_MONOSPACE_KEY]) applyValueFontMonospace(String(parsed[VALUE_FONT_MONOSPACE_KEY]).replace(/^"|"$/g, '') === 'true'); } catch (e) {}
  try { const valueFontMonospaceToggle = document.getElementById('valueFontMonospaceToggle'); if (valueFontMonospaceToggle && parsed[VALUE_FONT_MONOSPACE_KEY]) valueFontMonospaceToggle.checked = String(parsed[VALUE_FONT_MONOSPACE_KEY]).replace(/^"|"$/g, '') === 'true'; } catch (e) {}
  try { if (parsed[FONT_BOLD_KEY]) applyFontBold(String(parsed[FONT_BOLD_KEY]).replace(/^"|"$/g, '') === 'true'); } catch (e) {}
  try { const fontBoldToggle = document.getElementById('fontBoldToggle'); if (fontBoldToggle && parsed[FONT_BOLD_KEY]) fontBoldToggle.checked = String(parsed[FONT_BOLD_KEY]).replace(/^"|"$/g, '') === 'true'; } catch (e) {}
  try { if (parsed[DISABLE_GLOW_EFFECTS_KEY]) applyDisableGlowEffects(String(parsed[DISABLE_GLOW_EFFECTS_KEY]).replace(/^"|"$/g, '') === 'true'); } catch (e) {}
  try { const disableGlowEffectsToggle = document.getElementById('disableGlowEffectsToggle'); if (disableGlowEffectsToggle && parsed[DISABLE_GLOW_EFFECTS_KEY]) disableGlowEffectsToggle.checked = String(parsed[DISABLE_GLOW_EFFECTS_KEY]).replace(/^"|"$/g, '') === 'true'; } catch (e) {}
  try {
    if (Object.prototype.hasOwnProperty.call(parsed, ANIMATION_SETTINGS_KEY)) {
      applyAnimationSettings(parsed[ANIMATION_SETTINGS_KEY]);
    } else if (Object.prototype.hasOwnProperty.call(parsed, DISABLE_SETTINGS_ANIMATIONS_KEY)) {
      applyAnimationSettings({
        ...loadAnimationSettings(),
        settingsDropdowns: String(parsed[DISABLE_SETTINGS_ANIMATIONS_KEY]).replace(/^"|"$/g, '') !== 'true'
      });
    }
  } catch (e) {}
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

  try {
    syncSensorHideUntickedButton();
    applySensorSelectionFilter();
  } catch (e) {}

  await persistCrossProcessSettingsFromSnapshot(parsed);
  closeImportSettingsModal();
}

async function applyImportedSettingsAndReload() {
  const modal = document.getElementById('importSettingsModal');
  if (!modal) return;
  let parsed = {};
  try { parsed = JSON.parse(modal.dataset.parsed || '{}'); } catch (e) { parsed = {}; }
  parsed = normalizeEnhancedAdministratorSnapshot(parsed);

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
  await persistCrossProcessSettingsFromSnapshot(parsed);
  await prepareSensorCollectorForReload();
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

const settingsDisclosureAnimations = new WeakMap();
const activeSettingsDisclosureContents = new Set();

function settingsDisclosureMotionEnabled() {
  return !document.body.classList.contains('no-settings-animations');
}

function cancelSettingsDisclosureAnimation(content, preserveHeight = false) {
  const active = settingsDisclosureAnimations.get(content);
  if (!active) return;
  active.cancel(preserveHeight);
}

function settleSettingsDisclosureAnimations() {
  Array.from(activeSettingsDisclosureContents).forEach((content) => {
    cancelSettingsDisclosureAnimation(content, false);
  });
}

function setSettingsDisclosureExpanded(owner, toggleButton, expanded, contentSelector, options = {}) {
  const content = options.content || owner.querySelector(`:scope > ${contentSelector}`);
  const isExpanded = !!expanded;
  const ariaExpanded = toggleButton.getAttribute('aria-expanded');
  const currentlyExpanded = ariaExpanded === null
    ? !owner.classList.contains('is-collapsed')
    : ariaExpanded === 'true';

  toggleButton.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
  if (!content) {
    owner.classList.toggle('is-collapsed', !isExpanded);
    return;
  }

  content.setAttribute('aria-hidden', isExpanded ? 'false' : 'true');
  content.toggleAttribute('inert', !isExpanded);

  const animate = options.animate !== false && settingsDisclosureMotionEnabled();
  if (!animate) {
    cancelSettingsDisclosureAnimation(content, false);
    owner.classList.toggle('is-collapsed', !isExpanded);
    content.style.removeProperty('max-height');
    return;
  }

  // Repeated search updates can request an already-open section. Let any active
  // transition finish instead of restarting it and causing a visible stutter.
  if (currentlyExpanded === isExpanded) return;

  const startHeight = content.getBoundingClientRect().height;
  cancelSettingsDisclosureAnimation(content, true);
  content.classList.add('is-settings-disclosure-preparing');
  content.style.maxHeight = `${Math.max(0, startHeight)}px`;
  void content.offsetHeight;
  content.classList.remove('is-settings-disclosure-preparing');
  void content.offsetHeight;
  content.classList.add('is-settings-disclosure-animating');
  const animationSpeed = ANIMATION_SPEED_PRESETS[loadAnimationSettings().speed];
  const durationMs = content.classList.contains('settings-group-content') ? animationSpeed.groupMs : animationSpeed.sectionMs;
  let timeoutId = null;
  let frameId = null;
  let animationRecord = null;

  const cleanup = (preserveHeight = false) => {
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    if (timeoutId !== null) window.clearTimeout(timeoutId);
    content.removeEventListener('transitionend', onTransitionEnd);
    content.classList.remove('is-settings-disclosure-animating', 'is-settings-disclosure-preparing');
    if (!preserveHeight) {
      owner.classList.toggle('is-collapsed', !isExpanded);
      content.style.removeProperty('max-height');
    }
    if (settingsDisclosureAnimations.get(content) === animationRecord) {
      settingsDisclosureAnimations.delete(content);
    }
    activeSettingsDisclosureContents.delete(content);
  };

  const onTransitionEnd = (event) => {
    if (event.target !== content || event.propertyName !== 'max-height') return;
    cleanup(false);
  };

  animationRecord = { cancel: cleanup };
  settingsDisclosureAnimations.set(content, animationRecord);
  activeSettingsDisclosureContents.add(content);
  content.addEventListener('transitionend', onTransitionEnd);

  // max-height always transitions between measured numeric values, avoiding
  // the browser's non-interpolable `height: auto` path in both directions.
  frameId = window.requestAnimationFrame(() => {
    frameId = null;
    owner.classList.toggle('is-collapsed', !isExpanded);
    const targetHeight = isExpanded ? content.scrollHeight : 0;
    content.style.maxHeight = `${Math.max(0, targetHeight)}px`;
  });
  timeoutId = window.setTimeout(() => cleanup(false), durationMs + 180);
}

function setSettingsSectionExpanded(section, toggleButton, expanded, options = {}) {
  setSettingsDisclosureExpanded(section, toggleButton, expanded, '.settings-section-content', options);
}

function setSettingsGroupExpanded(group, toggleButton, expanded, options = {}) {
  setSettingsDisclosureExpanded(group, toggleButton, expanded, '.settings-group-content', options);
}

const SETTINGS_GROUP_PRESENTATION = {
  Appearance: {
    icon: 'bi-palette2',
    description: 'Theme, typography, dashboard layout and overlay'
  },
  Monitoring: {
    icon: 'bi-activity',
    description: 'Sources, sensor visibility, ordering and alerts'
  },
  'Backup / Restore': {
    icon: 'bi-shield-check',
    description: 'Profiles, settings import and export'
  },
  Connectivity: {
    icon: 'bi-broadcast',
    description: 'Web Monitor and Discord presence'
  },
  'App Behavior': {
    icon: 'bi-window-stack',
    description: 'Startup, system tray and application updates'
  }
};

function setupSettingsSearch() {
  const sidebar = document.querySelector('.sidebar');
  const input = document.getElementById('settingsSearchInput');
  const clearButton = document.getElementById('settingsSearchClearBtn');
  const status = document.getElementById('settingsSearchStatus');
  if (!sidebar || !input || input.dataset.settingsSearchReady === 'true') return;

  const groups = Array.from(sidebar.querySelectorAll('.settings-group'));
  let searchActive = false;

  const restoreAccordionState = () => {
    groups.forEach((group) => {
      const groupToggle = group.querySelector(':scope > .settings-group-toggle-btn');
      const wasCollapsed = group.dataset.searchWasCollapsed === 'true';
      if (groupToggle) {
        setSettingsGroupExpanded(group, groupToggle, !wasCollapsed, { animate: false });
      } else {
        group.classList.toggle('is-collapsed', wasCollapsed);
      }
      delete group.dataset.searchWasCollapsed;
      group.classList.remove('is-settings-search-hidden', 'is-settings-search-match');

      group.querySelectorAll('.settings-section').forEach((section) => {
        const sectionToggle = section.querySelector(':scope > .settings-toggle-btn');
        const sectionWasCollapsed = section.dataset.searchWasCollapsed === 'true';
        if (sectionToggle) {
          setSettingsSectionExpanded(section, sectionToggle, !sectionWasCollapsed, { animate: false });
        } else {
          section.classList.toggle('is-collapsed', sectionWasCollapsed);
        }
        delete section.dataset.searchWasCollapsed;
        section.classList.remove('is-settings-search-hidden', 'is-settings-search-match');
      });
    });
  };

  const applyFilter = () => {
    const query = normalizeSensorSearchText(input.value);
    const hasQuery = query.length > 0;

    if (hasQuery && !searchActive) {
      groups.forEach((group) => {
        group.dataset.searchWasCollapsed = group.classList.contains('is-collapsed') ? 'true' : 'false';
        group.querySelectorAll('.settings-section').forEach((section) => {
          section.dataset.searchWasCollapsed = section.classList.contains('is-collapsed') ? 'true' : 'false';
        });
      });
    } else if (!hasQuery && searchActive) {
      restoreAccordionState();
    }

    searchActive = hasQuery;
    document.body.classList.toggle('settings-searching', hasQuery);
    if (clearButton) clearButton.hidden = !hasQuery;

    if (!hasQuery) {
      if (status) {
        status.hidden = true;
        status.textContent = '';
      }
      return;
    }

    let matchingSections = 0;
    groups.forEach((group) => {
      const groupToggle = group.querySelector(':scope > .settings-group-toggle-btn');
      const groupTitle = normalizeSensorSearchText(groupToggle?.querySelector('.settings-group-toggle-title')?.textContent || '');
      const groupDescription = normalizeSensorSearchText(groupToggle?.querySelector('.settings-group-toggle-description')?.textContent || '');
      const groupMatches = groupTitle.includes(query) || groupDescription.includes(query);
      let visibleSections = 0;

      group.querySelectorAll('.settings-section').forEach((section) => {
        const sectionText = normalizeSensorSearchText(section.textContent);
        const matches = groupMatches || sectionText.includes(query);
        section.classList.toggle('is-settings-search-hidden', !matches);
        section.classList.toggle('is-settings-search-match', matches && !groupMatches);
        if (!matches) return;
        visibleSections += 1;
        matchingSections += 1;
        if (!groupMatches) {
          const sectionToggle = section.querySelector(':scope > .settings-toggle-btn');
          if (sectionToggle) setSettingsSectionExpanded(section, sectionToggle, true);
        }
      });

      const groupVisible = visibleSections > 0;
      group.classList.toggle('is-settings-search-hidden', !groupVisible);
      group.classList.toggle('is-settings-search-match', groupMatches);
      if (groupVisible && groupToggle) setSettingsGroupExpanded(group, groupToggle, true);
    });

    if (status) {
      status.hidden = false;
      status.textContent = matchingSections === 0
        ? 'No settings found'
        : `${matchingSections} matching ${matchingSections === 1 ? 'section' : 'sections'}`;
    }
  };

  input.dataset.settingsSearchReady = 'true';
  input.addEventListener('input', applyFilter);
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !input.value) return;
    event.preventDefault();
    input.value = '';
    applyFilter();
  });
  if (clearButton) {
    clearButton.addEventListener('click', () => {
      input.value = '';
      applyFilter();
      input.focus();
    });
  }
}

function setupSettingsGroupAccordion() {
  const groups = Array.from(document.querySelectorAll('.sidebar .settings-group'));
  if (!groups.length) return;

  const savedState = loadSettingsAccordionState();

  groups.forEach((group, index) => {
    if (group.dataset.groupAccordionReady === 'true') return;

    const titleEl = group.querySelector(':scope > .settings-group-title');
    const groupTitle = titleEl ? titleEl.textContent.trim() : `Group ${index + 1}`;
    const groupKeyBase = groupTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `group_${index + 1}`;
    const groupKey = `group_${groupKeyBase}`;

    const contentWrap = document.createElement('div');
    contentWrap.className = 'settings-group-content';

    const moveNodes = Array.from(group.children).filter((child) => child !== titleEl);
    moveNodes.forEach((child) => contentWrap.appendChild(child));

    if (titleEl) titleEl.remove();

    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'settings-group-toggle-btn';
    const presentation = SETTINGS_GROUP_PRESENTATION[groupTitle] || { icon: 'bi-sliders2-vertical', description: 'Application settings' };
    toggleButton.innerHTML = `
      <span class="settings-group-toggle-main">
        <span class="settings-group-toggle-mark"><i class="bi ${escapeHtml(presentation.icon)}" aria-hidden="true"></i></span>
        <span class="settings-group-toggle-copy">
          <span class="settings-group-toggle-title">${escapeHtml(groupTitle)}</span>
          <span class="settings-group-toggle-description">${escapeHtml(presentation.description)}</span>
        </span>
      </span>
      <span class="settings-group-toggle-icon" aria-hidden="true"><i class="bi bi-chevron-down"></i></span>`;

    const isExpanded = savedState[groupKey] !== undefined ? !!savedState[groupKey] : true;
    setSettingsGroupExpanded(group, toggleButton, isExpanded, { animate: false, content: contentWrap });

    toggleButton.addEventListener('click', () => {
      const nextExpanded = toggleButton.getAttribute('aria-expanded') !== 'true';
      setSettingsGroupExpanded(group, toggleButton, nextExpanded);
      updateSettingsAccordionState(groupKey, nextExpanded);
    });

    group.dataset.groupAccordionReady = 'true';
    group.dataset.groupKey = groupKey;
    group.appendChild(toggleButton);
    group.appendChild(contentWrap);
  });
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
    const explicitSectionKey = String(section.dataset.sectionKey || '').trim();
    const nearestGroup = section.closest('.settings-group');
    const groupScopeKey = nearestGroup ? String(nearestGroup.dataset.groupKey || '').trim() : '';
    const fallbackSectionSlug = sectionTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `section_${index + 1}`;
    const sectionKey = explicitSectionKey || (groupScopeKey ? `${groupScopeKey}_${fallbackSectionSlug}` : fallbackSectionSlug);

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
    setSettingsSectionExpanded(section, toggleButton, isExpanded, { animate: false, content: contentWrap });

    toggleButton.addEventListener('click', () => {
      const nextExpanded = toggleButton.getAttribute('aria-expanded') !== 'true';
      setSettingsSectionExpanded(section, toggleButton, nextExpanded);
      updateSettingsAccordionState(sectionKey, nextExpanded);
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
  const layoutPresetId = getSelectedLayoutPreset();
  const layoutPreset = getActiveLayoutConfig(layoutPresetId);
  const isCustomLayout = layoutPresetId === 'custom';
  const container = document.getElementById('statsContainer');
  const containerStyles = container ? getComputedStyle(container) : null;
  const measuredColumns = containerStyles
    ? Math.max(1, containerStyles.gridTemplateColumns.split(' ').filter((track) => (parseFloat(track) || 0) > 1).length)
    : 1;
  const columns = isCustomLayout ? CUSTOM_LAYOUT_COLUMNS : measuredColumns;
  const gap = containerStyles ? (parseFloat(containerStyles.columnGap || containerStyles.gap || '14') || 14) : 14;
  const containerWidth = container ? container.clientWidth : window.innerWidth;
  const columnWidth = Math.max(isCustomLayout ? 1 : 120, (containerWidth - (gap * (columns - 1))) / columns);
  const minCardWidthPx = layoutPreset.minCardWidth;
  const minSpan = Math.max(1, Math.ceil((minCardWidthPx + gap) / (columnWidth + gap)));
  const defaultCardWidthPx = Math.max(minCardWidthPx, Number(layoutPreset.defaultCardWidth) || minCardWidthPx);
  const defaultSpan = Math.max(minSpan, Math.ceil((defaultCardWidthPx + gap) / (columnWidth + gap)));
  let changed = false;

  const cards = document.querySelectorAll('.sensor-group');
  cards.forEach((card) => {
    const savedEntry = sizes[card.id];
    const savedHeight = Number(typeof savedEntry === 'object' ? savedEntry.height : savedEntry);
    const savedSpan = Number(typeof savedEntry === 'object' ? savedEntry.span : NaN);
    const savedWidth = Number(typeof savedEntry === 'object' ? savedEntry.width : NaN);

    if (Number.isFinite(savedHeight) && savedHeight >= 220 && savedHeight <= 900) {
      if (isCustomLayout) {
        const rowSpan = Math.max(1, Math.round((savedHeight + gap) / (CUSTOM_LAYOUT_ROW_HEIGHT + gap)));
        card.style.gridRow = `span ${rowSpan}`;
        card.style.height = 'auto';
      } else {
        card.style.removeProperty('grid-row');
        card.style.height = `${savedHeight}px`;
      }
    } else if (isCustomLayout) {
      const rowSpan = Math.max(1, Math.round((layoutPreset.cardHeight + gap) / (CUSTOM_LAYOUT_ROW_HEIGHT + gap)));
      card.style.gridRow = `span ${rowSpan}`;
      card.style.height = 'auto';
    } else {
      card.style.removeProperty('height');
      card.style.removeProperty('grid-row');
    }

    let nextSpan = NaN;
    if (Number.isFinite(savedWidth) && savedWidth >= 200) {
      const inferredSpan = Math.round((savedWidth + gap) / (columnWidth + gap));
      nextSpan = Math.min(Math.max(minSpan, inferredSpan), columns);
      if (Number.isFinite(savedSpan) && savedSpan !== nextSpan) {
        sizes[card.id] = { ...savedEntry, span: nextSpan };
        changed = true;
      }
    } else if (Number.isFinite(savedSpan) && savedSpan >= 1) {
      nextSpan = savedSpan;
    } else if (isCustomLayout) {
      nextSpan = defaultSpan;
    }

    if (Number.isFinite(nextSpan)) {
      const clampedSpan = Math.min(Math.max(minSpan, Math.round(nextSpan)), columns);
      card.style.gridColumn = `span ${clampedSpan}`;
      if (savedEntry && (typeof savedEntry !== 'object' || !Number.isFinite(Number(savedEntry.width)))) {
        sizes[card.id] = {
          height: Number.isFinite(savedHeight) ? savedHeight : layoutPreset.cardHeight,
          span: clampedSpan,
          width: Math.round((clampedSpan * (columnWidth + gap)) - gap)
        };
        changed = true;
      }
    } else {
      card.style.gridColumn = '';
    }
    card.style.removeProperty('width');
    card.style.removeProperty('justify-self');
  });

  if (changed) saveWindowSizes(sizes);
}

function setupWindowResize() {
  const cards = Array.from(document.querySelectorAll('.sensor-group'));
  const heightSnap = 20;
  const widthSnap = 1;

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
      event.preventDefault();
      event.stopPropagation();

      const container = document.getElementById('statsContainer');
      const containerStyles = container ? getComputedStyle(container) : null;
      const columns = containerStyles
        ? Math.max(1, containerStyles.gridTemplateColumns.split(' ').filter((track) => (parseFloat(track) || 0) > 1).length)
        : 1;
      const gap = containerStyles ? (parseFloat(containerStyles.columnGap || containerStyles.gap || '14') || 14) : 14;
      const containerWidth = container ? container.clientWidth : card.getBoundingClientRect().width;
      const layoutPresetId = getSelectedLayoutPreset();
      const isCustomLayout = layoutPresetId === 'custom';
      const effectiveColumns = isCustomLayout ? CUSTOM_LAYOUT_COLUMNS : columns;
      const columnWidth = Math.max(isCustomLayout ? 1 : 120, (containerWidth - (gap * (effectiveColumns - 1))) / effectiveColumns);
      const layoutPreset = getActiveLayoutConfig(layoutPresetId);
      const minCardWidthPx = layoutPreset.minCardWidth;
      const minSpan = Math.max(1, Math.ceil((minCardWidthPx + gap) / (columnWidth + gap)));

      const startX = event.clientX;
      const startY = event.clientY;
      const startWidth = card.getBoundingClientRect().width;
      const startHeight = card.getBoundingClientRect().height;
      const minHeight = 220;
      const maxHeight = Math.min(window.innerHeight - 120, 900);
      const currentSpanMatch = (card.style.gridColumn || '').match(/span\s+(\d+)/i);
      const startSpan = currentSpanMatch ? parseInt(currentSpanMatch[1], 10) : minSpan;

      card.classList.add('resizing');
      card.draggable = false;

      const onMove = (moveEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const delta = moveEvent.clientY - startY;
        const nextHeight = snapToStep(startHeight + delta, heightSnap, minHeight, maxHeight);
        if (isCustomLayout) {
          const nextRowSpan = Math.max(1, Math.round((nextHeight + gap) / (CUSTOM_LAYOUT_ROW_HEIGHT + gap)));
          card.style.gridRow = `span ${nextRowSpan}`;
          card.style.height = 'auto';
        } else {
          card.style.height = `${Math.round(nextHeight)}px`;
        }

        const desiredWidth = snapToStep(Math.max(columnWidth, startWidth + deltaX), widthSnap, columnWidth, containerWidth);
        const rawSpan = Math.round((desiredWidth + gap) / (columnWidth + gap));
        const nextSpan = Math.min(Math.max(minSpan, rawSpan || startSpan), effectiveColumns);
        card.style.gridColumn = `span ${nextSpan}`;
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        card.classList.remove('resizing');
        card.draggable = false;

        const finalHeight = snapToStep(card.getBoundingClientRect().height, heightSnap, minHeight, maxHeight);
        const finalSpanMatch = (card.style.gridColumn || '').match(/span\s+(\d+)/i);
        const finalSpan = finalSpanMatch ? Math.max(minSpan, parseInt(finalSpanMatch[1], 10)) : minSpan;
        const sizeMap = loadWindowSizes();
        sizeMap[card.id] = {
          height: finalHeight,
          span: finalSpan,
          width: Math.round(card.getBoundingClientRect().width)
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

function reorderCardIdsForDrop(allIds, sourceId, targetId, before = true) {
  const uniqueOrder = Array.from(new Set((Array.isArray(allIds) ? allIds : []).filter(Boolean)));
  if (!uniqueOrder.includes(sourceId)) return uniqueOrder;
  const nextOrder = uniqueOrder.filter((id) => id !== sourceId);
  const targetIndex = nextOrder.indexOf(targetId);
  const insertionIndex = targetIndex < 0
    ? nextOrder.length
    : targetIndex + (before ? 0 : 1);
  nextOrder.splice(insertionIndex, 0, sourceId);
  return nextOrder;
}

function setupWindowDragAndDrop() {
  const container = document.getElementById('statsContainer');
  if (!container || container.dataset.cardDragReady === 'true') return;
  container.dataset.cardDragReady = 'true';

  Array.from(container.querySelectorAll('.sensor-group')).forEach((card) => {
    card.draggable = false;
  });

  const marker = document.createElement('div');
  marker.className = 'card-drop-marker';
  marker.hidden = true;
  document.body.appendChild(marker);

  let dragState = null;
  let autoScrollFrame = null;
  let suppressClickUntil = 0;

  const getVisualCards = (sourceId) => Array.from(container.querySelectorAll('.sensor-group'))
    .filter((card) => card.id !== sourceId && card.offsetParent !== null)
    .map((card) => ({ card, rect: card.getBoundingClientRect() }))
    .filter((entry) => entry.rect.width > 0 && entry.rect.height > 0);

  const resolvePlacement = (clientX, clientY, sourceId) => {
    const entries = getVisualCards(sourceId);
    if (!entries.length) return null;
    entries.sort((a, b) => (a.rect.top - b.rect.top) || (a.rect.left - b.rect.left));

    const rows = [];
    entries.forEach((entry) => {
      const existing = rows.find((row) => Math.abs(row.top - entry.rect.top) <= 32);
      if (existing) {
        existing.entries.push(entry);
        existing.top = Math.min(existing.top, entry.rect.top);
        existing.bottom = Math.max(existing.bottom, entry.rect.bottom);
      } else {
        rows.push({ top: entry.rect.top, bottom: entry.rect.bottom, entries: [entry] });
      }
    });
    rows.sort((a, b) => a.top - b.top);
    rows.forEach((row) => row.entries.sort((a, b) => a.rect.left - b.rect.left));

    if (clientY < rows[0].top - 18) {
      return { target: rows[0].entries[0], before: true, orientation: 'horizontal' };
    }
    const lastRow = rows[rows.length - 1];
    if (clientY > lastRow.bottom + 18) {
      return {
        target: lastRow.entries[lastRow.entries.length - 1],
        before: false,
        orientation: 'horizontal'
      };
    }

    let selectedRow = rows[rows.length - 1];
    for (let index = 0; index < rows.length; index += 1) {
      // Compare row origins rather than row bottoms. Dense custom grids can place
      // another row beside a much taller card, so bottom-based boundaries overlap.
      const nextTop = rows[index + 1] ? rows[index + 1].top : rows[index].bottom;
      const boundary = rows[index + 1]
        ? (rows[index].top + nextTop) / 2
        : rows[index].bottom;
      if (clientY <= boundary) {
        selectedRow = rows[index];
        break;
      }
    }
    const nextEntry = selectedRow.entries.find((entry) => clientX < (entry.rect.left + (entry.rect.width / 2)));
    if (nextEntry) return { target: nextEntry, before: true, orientation: 'vertical' };
    return {
      target: selectedRow.entries[selectedRow.entries.length - 1],
      before: false,
      orientation: 'vertical'
    };
  };

  const updateMarker = (placement) => {
    if (!placement || !placement.target) {
      marker.hidden = true;
      return;
    }
    const rect = placement.target.card.getBoundingClientRect();
    marker.hidden = false;
    marker.classList.toggle('is-vertical', placement.orientation === 'vertical');
    marker.classList.toggle('is-horizontal', placement.orientation !== 'vertical');
    if (placement.orientation === 'vertical') {
      marker.style.left = `${Math.round(placement.before ? rect.left - 2 : rect.right - 2)}px`;
      marker.style.top = `${Math.round(rect.top)}px`;
      marker.style.height = `${Math.round(rect.height)}px`;
      marker.style.width = '4px';
    } else {
      marker.style.left = `${Math.round(rect.left)}px`;
      marker.style.top = `${Math.round(placement.before ? rect.top - 2 : rect.bottom - 2)}px`;
      marker.style.width = `${Math.round(rect.width)}px`;
      marker.style.height = '4px';
    }
  };

  const updatePlacement = () => {
    if (!dragState || !dragState.active) return;
    dragState.placement = resolvePlacement(dragState.clientX, dragState.clientY, dragState.sourceId);
    updateMarker(dragState.placement);
  };

  const runAutoScroll = () => {
    autoScrollFrame = null;
    if (!dragState || !dragState.active) return;
    const rect = container.getBoundingClientRect();
    const edge = Math.min(90, Math.max(48, rect.height * 0.12));
    let speed = 0;
    if (dragState.clientY < rect.top + edge) {
      speed = -Math.ceil(18 * (1 - Math.max(0, dragState.clientY - rect.top) / edge));
    } else if (dragState.clientY > rect.bottom - edge) {
      speed = Math.ceil(18 * (1 - Math.max(0, rect.bottom - dragState.clientY) / edge));
    }
    if (speed !== 0) {
      const previousScrollTop = container.scrollTop;
      container.scrollTop += speed;
      if (container.scrollTop !== previousScrollTop) updatePlacement();
    }
    autoScrollFrame = window.requestAnimationFrame(runAutoScroll);
  };

  const finishDrag = (commit) => {
    if (!dragState) return;
    const state = dragState;
    dragState = null;
    if (autoScrollFrame !== null) {
      window.cancelAnimationFrame(autoScrollFrame);
      autoScrollFrame = null;
    }
    marker.hidden = true;
    document.body.classList.remove('card-drag-active');
    state.sourceCard.classList.remove('dragging');

    if (commit && state.active && state.placement && state.placement.target) {
      const allCards = Array.from(container.querySelectorAll('.sensor-group'));
      const order = reorderCardIdsForDrop(
        allCards.map((card) => card.id),
        state.sourceId,
        state.placement.target.card.id,
        state.placement.before
      );
      const cardById = new Map(allCards.map((card) => [card.id, card]));
      order.forEach((id) => {
        const card = cardById.get(id);
        if (card) container.appendChild(card);
      });
      saveWindowOrder(order, state.layoutMode);
      suppressClickUntil = Date.now() + 250;
    }
  };

  container.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || dragState) return;
    const title = event.target.closest('.sensor-group-title');
    const sourceCard = title ? title.closest('.sensor-group') : null;
    if (!title || !sourceCard || !sourceCard.id || event.target.closest('button, input, select, textarea, a')) return;
    dragState = {
      pointerId: event.pointerId,
      sourceId: sourceCard.id,
      sourceCard,
      layoutMode: getCurrentLayoutMode(),
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      placement: null,
      active: false
    };
  });

  document.addEventListener('pointermove', (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    dragState.clientX = event.clientX;
    dragState.clientY = event.clientY;
    if (!dragState.active && Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) >= 6) {
      dragState.active = true;
      document.body.classList.add('card-drag-active');
      dragState.sourceCard.classList.add('dragging');
      autoScrollFrame = window.requestAnimationFrame(runAutoScroll);
    }
    if (dragState.active) {
      event.preventDefault();
      updatePlacement();
    }
  }, { passive: false });

  document.addEventListener('pointerup', (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    finishDrag(true);
  });
  document.addEventListener('pointercancel', (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    finishDrag(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dragState) finishDrag(false);
  });
  container.addEventListener('click', (event) => {
    if (Date.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
}

function setupStackedDashboardWheelScroll() {
  const container = document.getElementById('statsContainer');
  if (!container || container.dataset.stackedWheelReady === 'true') return;
  container.dataset.stackedWheelReady = 'true';

  container.addEventListener('wheel', (event) => {
    if (!document.body.classList.contains('layout-stacked') || event.ctrlKey) return;
    const eventTarget = event.target instanceof Element ? event.target : null;
    if (!eventTarget || !eventTarget.closest('.sensor-group')) return;

    let delta = Number(event.deltaY || event.deltaX || 0);
    if (event.deltaMode === 1) delta *= 18;
    if (event.deltaMode === 2) delta *= Math.max(1, container.clientHeight);
    if (!Number.isFinite(delta) || delta === 0) return;

    event.preventDefault();
    event.stopPropagation();
    container.scrollTop += delta;
  }, { capture: true, passive: false });
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

function applyDisableGlowEffects(enabled) {
  const isEnabled = !!enabled;
  document.body.classList.toggle('no-glow', isEnabled);
  localStorage.setItem(DISABLE_GLOW_EFFECTS_KEY, isEnabled ? 'true' : 'false');
}

function normalizeAnimationSpeed(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ANIMATION_SPEED_PRESETS, normalized) ? normalized : 'standard';
}

function normalizeAnimationIntensity(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ANIMATION_INTENSITY_PRESETS, normalized) ? normalized : 'balanced';
}

function normalizeAnimationSettings(value) {
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch (e) { parsed = {}; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};
  return {
    enabled: parsed.enabled !== false,
    settingsDropdowns: parsed.settingsDropdowns !== false,
    dialogs: parsed.dialogs !== false,
    viewTransitions: parsed.viewTransitions !== false,
    sensorIcons: parsed.sensorIcons !== false,
    settingsIcons: parsed.settingsIcons !== false,
    speed: normalizeAnimationSpeed(parsed.speed),
    intensity: normalizeAnimationIntensity(parsed.intensity)
  };
}

function applyAnimationPresetVariables(settings) {
  const normalized = normalizeAnimationSettings(settings);
  const speed = ANIMATION_SPEED_PRESETS[normalized.speed];
  const intensity = ANIMATION_INTENSITY_PRESETS[normalized.intensity];
  const root = document.documentElement;
  root.style.setProperty('--motion-icon-duration', `${speed.iconMs}ms`);
  root.style.setProperty('--motion-focus-duration', `${speed.focusMs}ms`);
  root.style.setProperty('--motion-dialog-duration', `${speed.dialogMs}ms`);
  root.style.setProperty('--motion-view-duration', `${speed.viewMs}ms`);
  root.style.setProperty('--motion-settings-group-duration', `${speed.groupMs}ms`);
  root.style.setProperty('--motion-settings-section-duration', `${speed.sectionMs}ms`);
  root.style.setProperty('--motion-icon-lift', `${intensity.iconLift}px`);
  root.style.setProperty('--motion-icon-scale', String(intensity.iconScale));
  root.style.setProperty('--motion-focus-rotate', `${intensity.focusRotate}deg`);
  root.style.setProperty('--motion-focus-scale', String(intensity.focusScale));
  root.style.setProperty('--motion-view-distance', `${intensity.viewDistance}px`);
  root.style.setProperty('--motion-view-scale', String(intensity.viewScale));
  root.style.setProperty('--motion-dialog-distance', `${intensity.dialogDistance}px`);
  root.style.setProperty('--motion-disclosure-distance', `${intensity.disclosureDistance}px`);
}

function loadAnimationSettings() {
  const raw = localStorage.getItem(ANIMATION_SETTINGS_KEY);
  if (raw !== null) return normalizeAnimationSettings(raw);

  // V1.3.2 originally exposed only this settings-specific opt-out. Preserve it
  // while enabling the newly added dialog, view, and sensor-icon effects.
  return normalizeAnimationSettings({
    ...DEFAULT_ANIMATION_SETTINGS,
    settingsDropdowns: localStorage.getItem(DISABLE_SETTINGS_ANIMATIONS_KEY) !== 'true'
  });
}

function syncAnimationSettingsControls(settings) {
  const normalized = normalizeAnimationSettings(settings);
  const controls = {
    animationEnabledToggle: normalized.enabled,
    animationSettingsToggle: normalized.settingsDropdowns,
    animationDialogsToggle: normalized.dialogs,
    animationViewsToggle: normalized.viewTransitions,
    animationSensorIconsToggle: normalized.sensorIcons,
    animationSettingsIconsToggle: normalized.settingsIcons
  };
  Object.entries(controls).forEach(([id, checked]) => {
    const input = document.getElementById(id);
    if (input) input.checked = checked;
  });

  const featureControls = document.getElementById('animationFeatureControls');
  if (featureControls) featureControls.classList.toggle('is-disabled', !normalized.enabled);
  const presetControls = document.getElementById('animationPresetControls');
  if (presetControls) presetControls.classList.toggle('is-disabled', !normalized.enabled);
  const speedSelect = document.getElementById('animationSpeedSelect');
  if (speedSelect) speedSelect.value = normalized.speed;
  const intensitySelect = document.getElementById('animationIntensitySelect');
  if (intensitySelect) intensitySelect.value = normalized.intensity;
  ['animationSettingsToggle', 'animationDialogsToggle', 'animationViewsToggle', 'animationSensorIconsToggle', 'animationSettingsIconsToggle'].forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.disabled = !normalized.enabled;
  });
  if (speedSelect) speedSelect.disabled = !normalized.enabled;
  if (intensitySelect) intensitySelect.disabled = !normalized.enabled;
}

function applyAnimationSettings(settings, options = {}) {
  const normalized = normalizeAnimationSettings(settings);
  const settingsMotionDisabled = !normalized.enabled || !normalized.settingsDropdowns;
  const dialogMotionDisabled = !normalized.enabled || !normalized.dialogs;
  const viewMotionDisabled = !normalized.enabled || !normalized.viewTransitions;
  const iconMotionDisabled = !normalized.enabled || !normalized.sensorIcons;
  const settingsIconMotionDisabled = !normalized.enabled || !normalized.settingsIcons;

  applyAnimationPresetVariables(normalized);
  ambientMotionDurationMs = ANIMATION_SPEED_PRESETS[normalized.speed].iconMs;

  document.body.classList.toggle('no-settings-animations', settingsMotionDisabled);
  document.body.classList.toggle('no-dialog-animations', dialogMotionDisabled);
  document.body.classList.toggle('no-view-animations', viewMotionDisabled);
  document.body.classList.toggle('no-sensor-icon-animations', iconMotionDisabled);
  document.body.classList.toggle('no-settings-icon-animations', settingsIconMotionDisabled);
  scheduleAmbientIconMotion(100);
  if (settingsMotionDisabled) settleSettingsDisclosureAnimations();
  if (viewMotionDisabled) {
    document.body.classList.remove('dashboard-view-to-summary', 'dashboard-view-to-dashboard');
    if (dashboardViewTransitionTimer !== null) window.clearTimeout(dashboardViewTransitionTimer);
    dashboardViewTransitionTimer = null;
  }

  if (options.persist !== false) {
    localStorage.setItem(ANIMATION_SETTINGS_KEY, JSON.stringify(normalized));
    localStorage.setItem(DISABLE_SETTINGS_ANIMATIONS_KEY, normalized.settingsDropdowns ? 'false' : 'true');
  }
  syncAnimationSettingsControls(normalized);
  return normalized;
}

function applyDisableSettingsAnimations(enabled) {
  applyAnimationSettings({
    ...loadAnimationSettings(),
    settingsDropdowns: !enabled
  });
}

function initializeAnimationSettingsControls() {
  const inputMap = {
    animationEnabledToggle: 'enabled',
    animationSettingsToggle: 'settingsDropdowns',
    animationDialogsToggle: 'dialogs',
    animationViewsToggle: 'viewTransitions',
    animationSensorIconsToggle: 'sensorIcons',
    animationSettingsIconsToggle: 'settingsIcons'
  };
  Object.entries(inputMap).forEach(([id, key]) => {
    const input = document.getElementById(id);
    if (!input || input.dataset.animationSettingReady === 'true') return;
    input.dataset.animationSettingReady = 'true';
    input.addEventListener('change', () => {
      applyAnimationSettings({ ...loadAnimationSettings(), [key]: !!input.checked });
    });
  });
  const selectMap = {
    animationSpeedSelect: 'speed',
    animationIntensitySelect: 'intensity'
  };
  Object.entries(selectMap).forEach(([id, key]) => {
    const select = document.getElementById(id);
    if (!select || select.dataset.animationSettingReady === 'true') return;
    select.dataset.animationSettingReady = 'true';
    select.addEventListener('change', () => {
      applyAnimationSettings({ ...loadAnimationSettings(), [key]: select.value });
    });
  });
  syncAnimationSettingsControls(loadAnimationSettings());
}

function applyFontBold(enabled) {
  if (enabled) {
    document.body.classList.add('font-bold');
  } else {
    document.body.classList.remove('font-bold');
  }
  localStorage.setItem(FONT_BOLD_KEY, enabled ? 'true' : 'false');
}

function normalizeOverlayFontSize(size) {
  return ['small', 'medium', 'large', 'xlarge', 'xxlarge'].includes(size) ? size : 'medium';
}
const OVERLAY_FONT_SIZE_STEPS = ['small', 'medium', 'large', 'xlarge', 'xxlarge'];
function overlayFontSizeToStep(size) {
  const normalized = normalizeOverlayFontSize(size);
  const idx = OVERLAY_FONT_SIZE_STEPS.indexOf(normalized);
  return idx >= 0 ? idx : 1;
}
function overlayFontSizeFromStep(step) {
  const n = Number(step);
  if (!Number.isFinite(n)) return 'medium';
  const clamped = Math.max(0, Math.min(OVERLAY_FONT_SIZE_STEPS.length - 1, Math.round(n)));
  return OVERLAY_FONT_SIZE_STEPS[clamped];
}
function overlayFontSizeLabel(sizeKey) {
  const map = {
    small: 'Small',
    medium: 'Medium',
    large: 'Large',
    xlarge: 'X-Large',
    xxlarge: 'XX-Large'
  };
  return map[normalizeOverlayFontSize(sizeKey)] || 'Medium';
}

function normalizeOverlayFontFamily(family) {
  return Object.prototype.hasOwnProperty.call(FONT_FAMILY_MAP, family) ? family : 'segoe';
}

function normalizeOverlayColor(color, fallback) {
  const normalized = String(color || '').trim();
  return /^#([0-9A-F]{3}){1,2}$/i.test(normalized) ? normalized : fallback;
}

function normalizeOverlayOpacity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 70;
  return Math.max(0, Math.min(100, Math.round(numeric / 5) * 5));
}

function normalizeOverlayFontBold(value) {
  return String(value || '').trim() === 'true';
}

function normalizeOverlayWidthPreset(value) {
  const valid = ['small', 'medium', 'large', 'wide', 'custom'];
  return valid.includes(String(value || '').trim()) ? String(value).trim() : 'medium';
}

function normalizeOverlayWidth(value, preset = 'medium') {
  const presets = {
    small: 280,
    medium: 360,
    large: 460,
    wide: 560
  };
  const normalizedPreset = normalizeOverlayWidthPreset(preset);
  if (normalizedPreset !== 'custom') {
    return presets[normalizedPreset] || presets.medium;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return presets.medium;
  return Math.max(260, Math.min(1000, Math.round(numeric / 10) * 10));
}

function normalizeOverlayPosition(value) {
  const valid = ['top-left', 'top-right'];
  return valid.includes(String(value || '').trim()) ? String(value).trim() : 'top-right';
}

function normalizeOverlayGroupSpacing(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(32, Math.round(numeric)));
}

function normalizeOverlayScale(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 100;
  return Math.max(50, Math.min(200, Math.round(numeric)));
}

function normalizeOverlayHotkey(value) {
  const hotkey = String(value || '').trim();
  if (!hotkey) return '';

  const parts = hotkey.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 1) return '';

  const validModifiers = ['ctrl', 'alt', 'shift', 'meta', 'commandorcontrol', 'cmd', 'command', 'control'];
  const modifiers = parts.slice(0, -1)
    .map((mod) => {
      const m = mod.toLowerCase();
      if (m === 'cmd' || m === 'command') return 'Meta';
      if (m === 'control') return 'Ctrl';
      if (m === 'commandorcontrol') return 'Ctrl';
      return mod.charAt(0).toUpperCase() + mod.slice(1).toLowerCase();
    });
  const keyRaw = parts[parts.length - 1];
  const key = String(keyRaw || '').trim();

  if (!modifiers.every(mod => validModifiers.includes(mod.toLowerCase()))) return '';
  if (!key || key.length === 0) return '';
  if (['ctrl', 'alt', 'shift', 'meta', 'command', 'cmd'].includes(key.toLowerCase())) return '';

  const keyMap = {
    esc: 'Escape',
    escape: 'Escape',
    return: 'Enter',
    plus: '+',
    spacebar: 'Space',
    del: 'Delete',
    ins: 'Insert',
    pgup: 'PageUp',
    pgdn: 'PageDown'
  };
  const lowerKey = key.toLowerCase();
  let normalizedKey = keyMap[lowerKey] || key;
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(normalizedKey)) normalizedKey = normalizedKey.toUpperCase();
  else if (/^num([0-9])$/i.test(normalizedKey)) normalizedKey = `num${normalizedKey.slice(-1)}`;
  else if (normalizedKey.length === 1) normalizedKey = normalizedKey.toUpperCase();
  else normalizedKey = normalizedKey.charAt(0).toUpperCase() + normalizedKey.slice(1);

  const uniqueModifiers = [...new Set(modifiers)];
  return uniqueModifiers.length > 0 ? `${uniqueModifiers.join('+')}+${normalizedKey}` : normalizedKey;
}

function normalizeOverlayStyle(value) {
  const valid = ['compact', 'grouped', 'category', 'grouped-line'];
  return valid.includes(String(value || '').trim()) ? String(value).trim() : 'compact';
}

function normalizeOverlayShowUnits(value) {
  return String(value || '').trim().toLowerCase() !== 'false';
}

function normalizeOverlayDragUnlock(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function normalizeOverlayCategoryOrder(raw) {
  let parsed = raw;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch (error) {
      parsed = [];
    }
  }
  const input = Array.isArray(parsed) ? parsed : [];
  const valid = new Set(SENSOR_GROUP_ORDER);
  const seen = new Set();
  const normalized = [];
  input.forEach((entry) => {
    const group = String(entry || '').trim().toLowerCase();
    if (!valid.has(group) || seen.has(group)) return;
    seen.add(group);
    normalized.push(group);
  });
  SENSOR_GROUP_ORDER.forEach((group) => {
    if (!seen.has(group)) normalized.push(group);
  });
  return normalized;
}

function loadOverlayCategoryOrder() {
  if (Array.isArray(overlayCategoryOrderCache) && overlayCategoryOrderCache.length) {
    return [...overlayCategoryOrderCache];
  }
  overlayCategoryOrderCache = normalizeOverlayCategoryOrder(localStorage.getItem(OVERLAY_CATEGORY_ORDER_KEY));
  return [...overlayCategoryOrderCache];
}

function saveOverlayCategoryOrder(order) {
  const normalized = normalizeOverlayCategoryOrder(order);
  overlayCategoryOrderCache = [...normalized];
  localStorage.setItem(OVERLAY_CATEGORY_ORDER_KEY, JSON.stringify(normalized));
  return normalized;
}

function renderOverlayCategoryOrderEditor(order) {
  const list = document.getElementById('overlayCategoryOrderList');
  if (!list) return;
  const normalized = normalizeOverlayCategoryOrder(order);
  list.innerHTML = normalized.map((group, index) => {
    const label = SENSOR_GROUP_LABELS[group] || group;
    return `
      <div class="overlay-category-order-item" draggable="true" data-overlay-category-order="${group}">
        <span class="overlay-category-order-handle" aria-hidden="true">⋮⋮</span>
        <span class="overlay-category-order-label">${escapeHtml(label)}</span>
        <span class="overlay-category-order-position">${index + 1}</span>
      </div>
    `;
  }).join('');
}

function normalizeOverlayCoordinate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric);
}

function formatOverlaySensor(sensor) {
  const resolvedUnits = resolveDisplayUnits(sensor) || sensor.units || inferUnitsFromSensor(sensor);
  const numericValue = Number(sensor.value);
  const hasNumericValue = Number.isFinite(numericValue);
  const sensorForFormatting = { ...sensor, units: resolvedUnits };
  const normalizedCurrent = hasNumericValue ? normalizeValueForDisplay(sensorForFormatting, numericValue) : null;
  return {
    ...sensor,
    displayValue: hasNumericValue && normalizedCurrent ? normalizedCurrent.value : sensor.value,
    displayUnits: hasNumericValue && normalizedCurrent ? normalizedCurrent.units : resolvedUnits,
    formatted: formatSensorValue(sensorForFormatting),
    displayLabel: getFinalDisplayLabel(sensor)
  };
}

function calculateOverlayHeight(payload, settings) {
  const count = Array.isArray(payload) ? payload.length : 0;
  const scaleMap = {
    small: 0.92,
    medium: 1,
    large: 1.18,
    xlarge: 1.32,
    xxlarge: 1.5
  };
  const scale = scaleMap[settings.fontSize] || 1;
  const headerHeight = 0;
  const contentPadding = 30;
  let itemHeight = Math.round(32 * scale + 4);
  let extraHeight = 0;
  let rows = count;

  if (settings.style === 'card') {
    itemHeight = Math.round(40 * scale + 8);
  }

  if (settings.style === 'grouped' || settings.style === 'category' || settings.style === 'grouped-line') {
    const groups = {};
    (Array.isArray(payload) ? payload : []).forEach((sensor) => {
      const label = String(sensor.group || sensor.category || '').trim() || 'General';
      groups[label] = (groups[label] || 0) + 1;
    });
    const groupCount = Math.max(1, Object.keys(groups).length);

    if (settings.style === 'grouped-line') {
      itemHeight = Math.round(32 * scale + 4);
      const lineLimit = 8;
      const lineRows = Object.values(groups).reduce((sum, sensorCount) => {
        const countForGroup = Math.max(1, Number(sensorCount) || 0);
        return sum + Math.min(lineLimit, countForGroup);
      }, 0);
      rows = Math.max(groupCount, lineRows);
      extraHeight = rows * 6;
    } else if (settings.style === 'category') {
      itemHeight = Math.round(38 * scale + 8);
      rows = count + groupCount;
      extraHeight = groupCount * 14;
    } else {
      itemHeight = Math.round(36 * scale + 6);
      rows = count + groupCount;
      extraHeight = groupCount * 10;
    }
  }

  if (settings.style === 'horizontal') {
    rows = 1;
    itemHeight = Math.round(34 * scale + 6);
  }

  const height = headerHeight + contentPadding + Math.max(1, rows) * itemHeight + extraHeight;
  return Math.max(140, Math.min(1200, height));
}

function loadOverlaySettings() {
  const widthPreset = normalizeOverlayWidthPreset(localStorage.getItem(OVERLAY_WIDTH_PRESET_KEY));
  const customX = normalizeOverlayCoordinate(localStorage.getItem(OVERLAY_CUSTOM_X_KEY));
  const customY = normalizeOverlayCoordinate(localStorage.getItem(OVERLAY_CUSTOM_Y_KEY));
  const customPositionEnabled = String(localStorage.getItem(OVERLAY_CUSTOM_POSITION_ENABLED_KEY) || '').trim().toLowerCase() === 'true'
    && customX !== null
    && customY !== null;
  return {
    enabled: localStorage.getItem(OVERLAY_ENABLED_KEY) === 'true',
    fontSize: normalizeOverlayFontSize(localStorage.getItem(OVERLAY_FONT_SIZE_KEY)),
    fontFamily: normalizeOverlayFontFamily(localStorage.getItem(OVERLAY_FONT_FAMILY_KEY)),
    fontBold: normalizeOverlayFontBold(localStorage.getItem(OVERLAY_FONT_BOLD_KEY)),
    textColor: normalizeOverlayColor(localStorage.getItem(OVERLAY_TEXT_COLOR_KEY), '#e0e0e0'),
    valueColor: normalizeOverlayColor(localStorage.getItem(OVERLAY_VALUE_COLOR_KEY), '#ffffff'),
    backgroundColor: normalizeOverlayColor(localStorage.getItem(OVERLAY_BG_COLOR_KEY), '#000000'),
    opacity: normalizeOverlayOpacity(localStorage.getItem(OVERLAY_OPACITY_KEY)),
    groupSpacing: normalizeOverlayGroupSpacing(localStorage.getItem(OVERLAY_GROUP_SPACING_KEY)),
    scale: normalizeOverlayScale(localStorage.getItem(OVERLAY_SCALE_KEY)),
    widthPreset,
    width: normalizeOverlayWidth(localStorage.getItem(OVERLAY_WIDTH_KEY), widthPreset),
    position: normalizeOverlayPosition(localStorage.getItem(OVERLAY_POSITION_KEY)),
    style: normalizeOverlayStyle(localStorage.getItem(OVERLAY_STYLE_KEY)),
    showUnits: normalizeOverlayShowUnits(localStorage.getItem(OVERLAY_SHOW_UNITS_KEY)),
    groupLineLimits: getOverlayGroupLineLimits(),
    categoryOrder: loadOverlayCategoryOrder(),
    displayId: localStorage.getItem(OVERLAY_MONITOR_KEY) || '',
    hotkey: normalizeOverlayHotkey(localStorage.getItem(OVERLAY_HOTKEY_KEY)),
    dragUnlock: normalizeOverlayDragUnlock(localStorage.getItem(OVERLAY_DRAG_UNLOCK_KEY)),
    customPositionEnabled,
    customX,
    customY
  };
}

function saveOverlaySetting(key, value) {
  localStorage.setItem(key, String(value));
}

function updateOverlayToggleButton(enabled) {
  const overlayToggleBtn = document.getElementById('overlayToggleBtn');
  if (!overlayToggleBtn) return;
  overlayToggleBtn.classList.remove('disabled', 'enabled');
  overlayToggleBtn.classList.add(enabled ? 'enabled' : 'disabled');
  const statusText = overlayToggleBtn.querySelector('.overlay-toggle-text');
  if (statusText) {
    statusText.textContent = enabled ? 'Overlay: On' : 'Overlay: Off';
  }
  overlayToggleBtn.title = enabled ? 'Hide Overlay' : 'Show Overlay';
}

function updateOverlayRangeReadouts(settings) {
  const groupSpacingValue = document.getElementById('overlayGroupSpacingValue');
  const scaleValue = document.getElementById('overlayScaleValue');
  const opacityValue = document.getElementById('overlayOpacityValue');
  if (groupSpacingValue) groupSpacingValue.textContent = `${normalizeOverlayGroupSpacing(settings.groupSpacing)} px`;
  if (scaleValue) scaleValue.textContent = `${normalizeOverlayScale(settings.scale)}%`;
  if (opacityValue) opacityValue.textContent = `${normalizeOverlayOpacity(settings.opacity)}%`;
}

function applyOverlaySettings() {
  const settings = loadOverlaySettings();
  const textColorInput = document.getElementById('overlayTextColor');
  const valueColorInput = document.getElementById('overlayValueColor');
  const bgColorInput = document.getElementById('overlayBackgroundColor');
  const overlayFontSizeSlider = document.getElementById('overlayFontSizeSlider');
  const overlayFontSizeValue = document.getElementById('overlayFontSizeValue');
  const overlayFontFamilySelect = document.getElementById('overlayFontFamilySelect');
  const overlayPositionSelect = document.getElementById('overlayPositionSelect');
  const overlayStyleSelect = document.getElementById('overlayStyleSelect');
  const overlayGroupSpacingInput = document.getElementById('overlayGroupSpacing');
  const overlayShowUnitsToggle = document.getElementById('overlayShowUnitsToggle');
  const overlayDragUnlockToggle = document.getElementById('overlayDragUnlockToggle');
  const overlayWidthSelect = document.getElementById('overlayWidthSelect');
  const overlayWidthInput = document.getElementById('overlayWidthInput');
  const overlayOpacityInput = document.getElementById('overlayOpacity');
  const overlayEnabledToggle = document.getElementById('overlayEnabledToggle');

  if (overlayEnabledToggle) {
    overlayEnabledToggle.checked = settings.enabled;
  }
  if (overlayFontSizeSlider) {
    overlayFontSizeSlider.value = String(overlayFontSizeToStep(settings.fontSize));
  }
  if (overlayFontSizeValue) {
    overlayFontSizeValue.textContent = overlayFontSizeLabel(settings.fontSize);
  }
  if (overlayFontFamilySelect) {
    overlayFontFamilySelect.value = settings.fontFamily;
  }
  if (textColorInput) {
    textColorInput.value = settings.textColor;
  }
  if (valueColorInput) {
    valueColorInput.value = settings.valueColor;
  }
  if (bgColorInput) {
    bgColorInput.value = settings.backgroundColor;
  }
  if (overlayWidthSelect) {
    overlayWidthSelect.value = settings.widthPreset;
  }
  if (overlayPositionSelect) {
    overlayPositionSelect.value = settings.position;
  }
  if (overlayStyleSelect) {
    overlayStyleSelect.value = settings.style;
  }
  if (overlayGroupSpacingInput) {
    overlayGroupSpacingInput.value = String(settings.groupSpacing);
  }
  if (overlayShowUnitsToggle) {
    overlayShowUnitsToggle.checked = settings.showUnits;
  }
  if (overlayDragUnlockToggle) {
    overlayDragUnlockToggle.checked = settings.dragUnlock;
  }
  if (overlayWidthInput) {
    overlayWidthInput.value = String(settings.width);
    overlayWidthInput.disabled = settings.widthPreset !== 'custom';
  }
  if (overlayOpacityInput) {
    overlayOpacityInput.value = String(settings.opacity);
  }
  const overlayScaleInput = document.getElementById('overlayScale');
  if (overlayScaleInput) {
    overlayScaleInput.value = String(settings.scale);
  }
  const overlayHotkeyInput = document.getElementById('overlayHotkey');
  if (overlayHotkeyInput) {
    overlayHotkeyInput.value = settings.hotkey;
  }
  updateOverlayRangeReadouts(settings);

  updateOverlayToggleButton(settings.enabled);

  if (settings.enabled && ipcRenderer && ipcRenderer.invoke) {
    ipcRenderer.invoke('overlay:set-enabled', true).catch(() => {});
    ipcRenderer.invoke('overlay:set-drag-enabled', settings.dragUnlock).catch(() => {});
  }
}

function normalizeOverlaySensorGroup(sensor) {
  if (!sensor) return sensor;
  const name = String(sensor.name || '').toLowerCase();
  if (name.includes('frame time') || name.includes('frametime') || /\bfps\b/.test(name)) {
    return 'fps';
  }
  return sensor.group || sensor.category || 'other';
}

function getOverlaySensorPayload(groupedSensors) {
  const output = [];
  const grouped = {};
  Object.keys(groupedSensors || {}).forEach((group) => {
    (Array.isArray(groupedSensors[group]) ? groupedSensors[group] : []).forEach((sensor) => {
      if (!sensor) return;
      const overlaySelected = overlaySensorSelection[sensor.id];
      const shouldDisplay = overlaySelected !== undefined ? overlaySelected : !!sensorSelection[sensor.id];
      if (!shouldDisplay) return;
      const normalizedGroup = String(normalizeOverlaySensorGroup(sensor) || 'other').trim().toLowerCase();
      if (!grouped[normalizedGroup]) grouped[normalizedGroup] = [];
      grouped[normalizedGroup].push(formatOverlaySensor({
        ...sensor,
        group: normalizedGroup,
        alertSeverity: activeSensorAlertState[sensor.id]?.severity || ''
      }));
    });
  });

  const preferredOrder = loadOverlayCategoryOrder();
  preferredOrder.forEach((group) => {
    (grouped[group] || []).forEach((sensor) => output.push(sensor));
  });

  Object.keys(grouped).forEach((group) => {
    if (preferredOrder.includes(group)) return;
    grouped[group].forEach((sensor) => output.push(sensor));
  });

  return output;
}

function sendOverlayPayload(payload) {
  if (!ipcRenderer || typeof ipcRenderer.send !== 'function') return;
  const settings = loadOverlaySettings();
  if (!settings.enabled) return;
  ipcRenderer.send('overlay:update', {
    settings,
    sensors: payload,
    position: settings.position
  });
}

function refreshOverlayWindowState(enabled) {
  if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') return;
  ipcRenderer.invoke('overlay:set-enabled', !!enabled).then(() => {
    const dragUnlock = normalizeOverlayDragUnlock(localStorage.getItem(OVERLAY_DRAG_UNLOCK_KEY));
    ipcRenderer.invoke('overlay:set-drag-enabled', dragUnlock).catch(() => {});
  }).catch(() => {});
}

// NOTE: getOverlaySensorPayload is defined once above and used for overlay sensor payload generation.
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
  currentTemperatureUnit = normalized;

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
  if (normalized === 'compact' || normalized === 'wide' || normalized === 'terminal' || normalized === 'rail' || normalized === 'glass' || normalized === 'split' || normalized === 'status') return normalized;
  return 'standard';
}

function applyLayoutPreset(presetId, options = {}) {
  const persist = options.persist !== false;
  const resetCustomSizes = options.resetCustomSizes === true;
  const mode = normalizeLayoutMode(options.mode || 'normal');
  const keys = getLayoutStorageKeys(mode);
  const normalized = normalizeLayoutPreset(presetId);
  const previous = getSelectedLayoutPreset(mode);
  const activeSizes = loadWindowSizes(mode);
  const hasActiveSizes = Object.keys(activeSizes).length > 0;
  const root = document.documentElement;
  let preset;

  if (normalized === 'custom') {
    const hasStoredConfig = !!localStorage.getItem(keys.config);
    if (!hasStoredConfig) {
      const basePresetId = previous === 'custom' || previous === 'stacked' ? DEFAULT_LAYOUT_PRESET : previous;
      preset = saveCustomLayoutConfig(getLayoutPreset(basePresetId), basePresetId, mode);
    } else {
      preset = loadCustomLayoutConfig(previous, mode);
    }

    if (previous !== 'custom') {
      const savedCustomSizes = loadCustomLayoutSizes(mode);
      if (Object.keys(savedCustomSizes).length > 0) {
        localStorage.setItem(keys.sizes, JSON.stringify(savedCustomSizes));
      } else if (hasActiveSizes) {
        saveCustomLayoutSizes(activeSizes, mode);
      }
    }
  } else {
    preset = getLayoutPreset(normalized);
    if (resetCustomSizes) {
      if (hasActiveSizes) {
        saveCustomLayoutSizes(activeSizes, mode);
        if (!localStorage.getItem(keys.config)) {
          const basePresetId = previous === 'stacked' || previous === 'custom' ? DEFAULT_LAYOUT_PRESET : previous;
          saveCustomLayoutConfig(getLayoutPreset(basePresetId), basePresetId, mode);
        }
      }
      localStorage.removeItem(keys.sizes);
    }
  }

  if (persist) {
    localStorage.setItem(keys.preset, normalized);
  }

  const select = document.getElementById(mode === 'summary' ? 'summaryLayoutPresetSelect' : 'layoutPresetSelect');
  if (select && select.value !== normalized) {
    select.value = normalized;
  }

  if (mode === getCurrentLayoutMode()) {
    root.style.setProperty('--layout-card-min-width', `${preset.minCardWidth}px`);
    root.style.setProperty('--layout-card-default-width', `${Number(preset.defaultCardWidth) || preset.minCardWidth}px`);
    root.style.setProperty('--layout-card-height', `${preset.cardHeight}px`);
    root.style.setProperty('--layout-card-gap', `${preset.gap}px`);
    document.body.classList.toggle('layout-stacked', preset.stacked === true);
    document.body.classList.toggle('layout-custom', normalized === 'custom');

    applyWindowSizes();
    invalidateRenderGroupCache();
    forceNextUiRender = true;
  }

  return normalized;
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

  document.body.classList.remove('view-compact', 'view-wide', 'view-terminal', 'view-rail', 'view-glass', 'view-split', 'view-status');
  if (normalized !== 'standard') {
    document.body.classList.add(`view-${normalized}`);
  }

  if (persist) {
    localStorage.setItem(VIEW_MODE_KEY, normalized);
  }

  const styleButtons = document.querySelectorAll('.style-btn');
  styleButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.viewMode === normalized);
  });

  applyDesktopGroupIconsForViewMode(normalized);

  applyWindowSizes();

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
    button.title = enabled ? 'Open Settings' : 'Close Settings';
    button.classList.toggle('active', !enabled);
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
    card.draggable = false;
  });
}

function formatDebugValue(value, digits = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'N/A';
  return n.toFixed(digits);
}

function renderDebugPanel(externalData, modeLabel) {
  const panel = document.getElementById('debugPanel');
  if (!panel) return;

  const external = externalData && typeof externalData === 'object' ? externalData : {};
  const frameDebug = external.frameTimeDebug && typeof external.frameTimeDebug === 'object'
    ? external.frameTimeDebug
    : {};

  const fps = Number(external.fps);
  const frameTime = Number(external.frameTime);
  const normalizedFrameTime = (Number.isFinite(frameTime) && frameTime > 0)
    ? frameTime
    : (Number.isFinite(fps) && fps > 0 ? (1000 / fps) : NaN);

  panel.innerHTML = `
    <div class="debug-grid">
      <div class="debug-card">
        <div class="debug-title">Current</div>
        <div class="debug-row"><span>Mode</span><strong>${escapeHtml(String(modeLabel || 'N/A'))}</strong></div>
        <div class="debug-row"><span>FPS</span><strong>${Number.isFinite(fps) ? fps.toFixed(2) : 'N/A'}</strong></div>
        <div class="debug-row"><span>Frame Time (final ms)</span><strong>${Number.isFinite(normalizedFrameTime) ? normalizedFrameTime.toFixed(4) : 'N/A'}</strong></div>
      </div>
      <div class="debug-card">
        <div class="debug-title">Frame Time Sources</div>
        <div class="debug-row"><span>MAHM</span><strong>${formatDebugValue(frameDebug.mahm)}</strong></div>
        <div class="debug-row"><span>RTSS Shared</span><strong>${formatDebugValue(frameDebug.rtssShared)}</strong></div>
        <div class="debug-row"><span>RTSS OSD</span><strong>${formatDebugValue(frameDebug.rtssOsd)}</strong></div>
        <div class="debug-row"><span>Selected Source</span><strong>${escapeHtml(String(frameDebug.selectedSource || 'none'))}</strong></div>
      </div>
    </div>
  `;
}

function applyDebugMode(enabled) {
  debugModeEnabled = !!enabled;
  document.body.classList.toggle('debug-mode', debugModeEnabled);
  localStorage.setItem(DEBUG_MODE_KEY, debugModeEnabled ? 'true' : 'false');

  const button = document.getElementById('debugModeBtn');
  if (button) {
    button.innerHTML = debugModeEnabled
      ? '<i class="bi bi-bug-fill" aria-hidden="true"></i><span>Exit Debug</span>'
      : '<i class="bi bi-bug" aria-hidden="true"></i><span>Debug</span>';
    button.classList.toggle('active', debugModeEnabled);
  }

  const panel = document.getElementById('debugPanel');
  if (panel && debugModeEnabled) {
    renderDebugPanel(lastDebugExternalData, localStorage.getItem('detectionMode') || 'builtin');
  }
}

function triggerDashboardViewTransition(toSummary) {
  if (document.body.classList.contains('no-view-animations')) return;
  const nextClass = toSummary ? 'dashboard-view-to-summary' : 'dashboard-view-to-dashboard';
  document.body.classList.remove('dashboard-view-to-summary', 'dashboard-view-to-dashboard');
  void document.body.offsetWidth;
  document.body.classList.add(nextClass);
  if (dashboardViewTransitionTimer !== null) window.clearTimeout(dashboardViewTransitionTimer);
  const viewDurationMs = ANIMATION_SPEED_PRESETS[loadAnimationSettings().speed].viewMs;
  dashboardViewTransitionTimer = window.setTimeout(() => {
    document.body.classList.remove(nextClass);
    dashboardViewTransitionTimer = null;
  }, viewDurationMs + 100);
}

function applySummaryMode(enabled, options = {}) {
  const nextEnabled = !!enabled;
  const changed = summaryModeEnabled !== nextEnabled;
  summaryModeEnabled = nextEnabled;
  document.body.classList.toggle('summary-mode', summaryModeEnabled);
  localStorage.setItem(SUMMARY_MODE_KEY, summaryModeEnabled ? 'true' : 'false');

  const button = document.getElementById('summaryModeBtn');
  if (button) {
    button.innerHTML = summaryModeEnabled
      ? '<i class="bi bi-grid-3x3-gap-fill" aria-hidden="true"></i><span>Exit Summary Mode</span>'
      : '<i class="bi bi-grid-1x2-fill" aria-hidden="true"></i><span>Summary Mode</span>';
    button.classList.toggle('active', summaryModeEnabled);
  }
  updateSummarySessionUi();

  if (summaryModeEnabled && debugModeEnabled) {
    applyDebugMode(false);
  }

  applyWindowOrder();
  const activeLayoutMode = getCurrentLayoutMode();
  applyLayoutPreset(getSelectedLayoutPreset(activeLayoutMode), {
    mode: activeLayoutMode,
    persist: false,
    resetCustomSizes: false
  });

  syncCardInteractionState();

  invalidateRenderGroupCache();
  renderAllDynamicGroups(latestSelectedGroupedSensors || createEmptyGroupedBuckets(), { force: true });
  if (changed && options.animate !== false) triggerDashboardViewTransition(summaryModeEnabled);
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
        sensorSelection[sensor.id] = sensor.defaultEnabled !== false;
      }
      if (overlaySensorSelection[sensor.id] === undefined) {
        overlaySensorSelection[sensor.id] = !!sensorSelection[sensor.id];
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
  if (typeof sensor.formatted === 'string' && sensor.formatted.trim()) {
    return sensor.formatted;
  }
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
  } else if (u === 'rpm' || u === 'fps' || u === '%' || u === 'mhz' || u === 'khz' || u === 'hz' || u === 's' || u === 'processes' || u === 'windows' || u === 'sensors' || u === 'alerts' || u === 'connections') {
    decimals = 0;
  } else if (u === 'ms') {
    decimals = 2;
  } else if (u === 'v' || u === 'a' || u === 'w' || u === '°c' || u === 'c' || u === '°f' || u === 'f' || u === 'ghz') {
    decimals = 2;
  } else if (u === 'gb' || u === 'mb' || u === 'kb' || u === 'tb') {
    decimals = 2;
  } else if (u === 'tb/s' || u === 'mb/s' || u === 'gb/s' || u === 'kb/s' || u === 'b/s' || u === 'mbps' || u === 'gbps' || u === 'kbps') {
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

function summarizeSensorSessionStats(stats) {
  if (!stats || !Number.isFinite(stats.min) || !Number.isFinite(stats.max) || !Number.isFinite(stats.sum) || !Number.isFinite(stats.count) || stats.count <= 0) {
    return null;
  }
  return {
    min: stats.min,
    average: stats.sum / stats.count,
    max: stats.max,
    count: stats.count
  };
}

function updateSummarySessionUi() {
  const controls = document.getElementById('summarySessionControls');
  if (controls) controls.hidden = !summaryModeEnabled;
}

function resetSensorSessionStatistics() {
  Object.keys(sensorSessionStats).forEach((sensorId) => delete sensorSessionStats[sensorId]);
  updateSensorSessionStats(latestSelectedGroupedSensors || createEmptyGroupedBuckets());
  updateSummarySessionUi();
  invalidateRenderGroupCache();
  renderAllDynamicGroups(latestSelectedGroupedSensors || createEmptyGroupedBuckets(), { force: true });
}

function renderSensorSummary(sensor) {
  const stats = summarizeSensorSessionStats(sensor && sensor.id ? sensorSessionStats[sensor.id] : null);
  if (!stats) {
    const rawValue = sensor ? sensor.value : null;
    if (typeof rawValue === 'string') {
      const staticText = rawValue.trim() || '--';
      return `<div class="stat-summary-line is-empty"><span class="summary-metric"><span class="summary-metric-label">Value</span><span class="summary-metric-value">${escapeHtml(staticText)}</span></span></div>`;
    }
    return '<div class="stat-summary-line is-empty">Collecting summary...</div>';
  }

  const minText = formatSensorNumericValue(sensor, stats.min);
  const averageText = formatSensorNumericValue(sensor, stats.average);
  const maxText = formatSensorNumericValue(sensor, stats.max);

  return `
    <div class="stat-summary-line" aria-label="Session summary">
      <span class="summary-metric"><span class="summary-metric-label">Min</span><span class="summary-metric-value">${escapeHtml(minText)}</span></span>
      <span class="summary-separator">•</span>
      <span class="summary-metric"><span class="summary-metric-label">Avg</span><span class="summary-metric-value">${escapeHtml(averageText)}</span></span>
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

  const preferredTempUnit = normalizeTemperatureUnit(currentTemperatureUnit);
  const lowerInitialUnits = String(displayUnits || '').toLowerCase().replace(/°/g, '');
  if (lowerInitialUnits === 'c' && preferredTempUnit === 'f') {
    value = celsiusToFahrenheit(value);
    displayUnits = '°F';
  } else if (lowerInitialUnits === 'f' && preferredTempUnit === 'c') {
    value = fahrenheitToCelsius(value);
    displayUnits = '°C';
  }

  if (group === 'network') {
    const networkKind = classifyNetworkSensor(sensor);
    displayUnits = resolveNetworkDisplayUnits(sensor, displayUnits);
    const scaled = scaleBinaryNetworkValue(value, displayUnits, networkKind);
    value = scaled.value;
    displayUnits = scaled.units;
  }

  if (group === 'ram' && /^(b|kb|mb|gb|tb)\/s$/i.test(String(displayUnits || ''))) {
    const scaled = scaleBinaryNetworkValue(value, displayUnits, 'rate');
    value = scaled.value;
    displayUnits = scaled.units;
  }

  if (group === 'ram' && name.includes('memory speed')) {
    displayUnits = 'GHz';
  }

  if (String(sensor && sensor.id || '') === 'app_uptime') {
    if (Math.abs(value) >= 86400) {
      value /= 86400;
      displayUnits = 'days';
    } else if (Math.abs(value) >= 3600) {
      value /= 3600;
      displayUnits = 'hours';
    } else if (Math.abs(value) >= 60) {
      value /= 60;
      displayUnits = 'min';
    } else {
      displayUnits = 's';
    }
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
    b: 'B',
    byte: 'B',
    bytes: 'B',
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
    mwh: 'mWh',
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
  const sensorType = String(sensor && sensor.sensorType ? sensor.sensorType : '').trim().toLowerCase();
  const provider = String(sensor && sensor.provider ? sensor.provider : '').trim().toLowerCase();

  if (name.includes('dram:fsb ratio') || name.includes('ratio')) return '';
  if (name.includes('timing')) return '';
  if (name.includes('multiplier')) return 'X';

  if (group === 'fans') return 'RPM';

  // Built-in hardware sensors include an authoritative type. Prefer it over
  // value/name heuristics so a GPU clock can never be relabelled as voltage
  // merely because an idle clock happens to be a small number.
  if (provider === 'builtin') {
    const unitsBySensorType = {
      temperature: '\u00B0C',
      load: '%',
      control: '%',
      clock: 'MHz',
      fan: 'RPM',
      power: 'W',
      voltage: 'V',
      current: 'A',
      data: 'GB',
      smalldata: 'MB',
      throughput: 'B/s',
      energy: 'mWh',
      frequency: 'Hz',
      address: ''
    };
    if (Object.prototype.hasOwnProperty.call(unitsBySensorType, sensorType)) {
      return unitsBySensorType[sensorType];
    }
  }

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
    return resolveNetworkDisplayUnits(sensor, normalized);
  }

  if (group === 'latency') {
    if (name.includes('loss')) return '%';
    return 'ms';
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
  const group = String(sensor && sensor.group ? sensor.group : '').toLowerCase();
  if (!name) return '';

  if (group === 'network') return resolveNetworkDisplayUnits(sensor, '');

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
      const displayLabel = String(sensor && sensor.displayLabel ? sensor.displayLabel : getFinalDisplayLabel(sensor));
      const alertSeverity = activeSensorAlertState[sensor.id]?.severity || '';
      return `${sensor.id}|${displayLabel}|${normalizedValue}|${sensor.units || ''}|${expanded}|alert:${alertSeverity}|summary:${summaryModeEnabled ? '1' : '0'}|${summarySignature}`;
    })
    .join('||');
}

function prepareSelectedSensorsForRender(selectedGroupedSensors) {
  Object.keys(selectedGroupedSensors || {}).forEach((group) => {
    (selectedGroupedSensors[group] || []).forEach((sensor) => {
      if (!sensor) return;
      sensor.displayLabel = getFinalDisplayLabel(sensor);
      sensor.formatted = formatSensorNumericValue(sensor, Number(sensor.value));
      if (!Number.isFinite(Number(sensor.value))) {
        const rawValue = sensor.value;
        if (rawValue === null || rawValue === undefined) sensor.formatted = '--';
        else if (typeof rawValue === 'string') sensor.formatted = rawValue.trim() || '--';
        else sensor.formatted = String(rawValue);
      }
    });
  });
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
  renderDynamicGroup('fpsSensorsDynamic', selected.fps);
  renderDynamicGroup('cpuSensorsDynamic', selected.cpu);
  renderDynamicGroup('gpuSensorsDynamic', selected.gpu);
  renderDynamicGroup('ramSensorsDynamic', selected.ram);
  renderDynamicGroup('psuSensorsDynamic', selected.psu);
  renderDynamicGroup('fansSensorsDynamic', selected.fans);
  renderDynamicGroup('networkSensorsDynamic', selected.network);
  renderDynamicGroup('latencySensorsDynamic', selected.latency);
  renderDynamicGroup('drivesSensorsDynamic', selected.drives);
  renderDynamicGroup('appSensorsDynamic', selected.app);
  renderDynamicGroup('externalSensorsDynamic', selected.other);
}

function refreshMotionVisibilityTargets(root = document) {
  if (!motionVisibilityObserver || !root || typeof root.querySelectorAll !== 'function') return;
  root.querySelectorAll('.sensor-group .group-icon, .sidebar i').forEach((icon) => {
    if (icon.classList.contains('motion-observed')) return;
    icon.classList.add('motion-observed');
    motionVisibilityObserver.observe(icon);
  });
}

function scheduleAmbientIconMotion(delayMs = 250) {
  clearTimeout(ambientMotionTimer);
  ambientMotionTimer = setTimeout(runAmbientIconMotionCycle, Math.max(0, Number(delayMs) || 0));
}

function runAmbientIconMotionCycle() {
  document.querySelectorAll('.ambient-icon-motion').forEach((icon) => {
    icon.classList.remove('ambient-icon-motion');
  });

  const body = document.body;
  const animationsEnabled = !body.classList.contains('app-inactive') &&
    (!body.classList.contains('no-sensor-icon-animations') || !body.classList.contains('no-settings-icon-animations'));
  if (!animationsEnabled) {
    scheduleAmbientIconMotion(Math.max(1000, ambientMotionDurationMs));
    return;
  }

  const sensorIcons = body.classList.contains('no-sensor-icon-animations')
    ? []
    : Array.from(document.querySelectorAll('.sensor-group .group-icon.motion-in-view'));
  const settingsIcons = body.classList.contains('no-settings-icon-animations') || !body.classList.contains('monitoring-mode')
    ? []
    : Array.from(document.querySelectorAll('.sidebar i.motion-in-view'));
  const candidates = sensorIcons.concat(settingsIcons)
    .filter((icon) => icon.offsetParent !== null && !icon.matches(':hover'));

  if (candidates.length) {
    const icon = candidates[ambientMotionCursor % candidates.length];
    ambientMotionCursor = (ambientMotionCursor + 1) % candidates.length;
    icon.classList.add('ambient-icon-motion');
  }

  scheduleAmbientIconMotion(ambientMotionDurationMs + 200);
}

function initializeMotionVisibilityTracking() {
  if (typeof IntersectionObserver !== 'function') return;
  motionVisibilityObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      entry.target.classList.toggle('motion-in-view', entry.isIntersecting);
    });
  }, { rootMargin: '96px' });
  document.body.classList.add('motion-visibility-ready');
  refreshMotionVisibilityTargets();
  scheduleAmbientIconMotion();
}

function syncDesktopActivityState() {
  const active = !document.hidden &&
    (typeof document.hasFocus !== 'function' || document.hasFocus());
  document.body.classList.toggle('app-inactive', !active);
  if (active) scheduleAmbientIconMotion(100);
  else clearTimeout(ambientMotionTimer);
  if (active && pendingVisibilityRefresh) {
    invalidateRenderGroupCache();
    renderAllDynamicGroups(latestSelectedGroupedSensors || createEmptyGroupedBuckets(), { force: true });
  }
}

function normalizeSensorSearchText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function sensorHideUntickedEnabled() {
  return localStorage.getItem(SENSOR_HIDE_UNTICKED_KEY) === 'true';
}

function syncSensorHideUntickedButton() {
  const button = document.getElementById('sensorHideUntickedBtn');
  if (!button) return;

  const enabled = sensorHideUntickedEnabled();
  button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  button.title = enabled
    ? 'Show every detected sensor'
    : 'Hide sensors that are not ticked';
  button.innerHTML = enabled
    ? '<i class="bi bi-eye" aria-hidden="true"></i><span>Show All</span>'
    : '<i class="bi bi-eye-slash" aria-hidden="true"></i><span>Hide Unticked</span>';
}

function applySensorSelectionFilter() {
  const input = document.getElementById('sensorSearchInput');
  const container = document.getElementById('sensorOptions');
  const emptyState = document.getElementById('sensorSearchEmpty');
  if (!input || !container) return;

  const query = normalizeSensorSearchText(input.value);
  const hasQuery = !!query;
  const hideUnticked = sensorHideUntickedEnabled();
  const hasActiveFilter = hasQuery || hideUnticked;
  if (hasQuery && !sensorSearchSessionActive) sensorSearchCollapsedGroups.clear();
  if (!hasQuery && sensorSearchSessionActive) sensorSearchCollapsedGroups.clear();
  sensorSearchSessionActive = hasQuery;
  let visibleSensorCount = 0;

  container.querySelectorAll('.sensor-category-block').forEach((block) => {
    const groupKey = String(block.dataset.sensorGroupKey || '').trim();
    const groupText = normalizeSensorSearchText(block.dataset.sensorGroupSearch);
    const groupMatches = hasQuery && groupText.includes(query);
    const rows = Array.from(block.querySelectorAll('.sensor-item-row'));
    let matchingRows = 0;

    rows.forEach((row) => {
      const rowText = normalizeSensorSearchText(row.dataset.sensorSearch || row.textContent);
      const searchMatches = !hasQuery || groupMatches || rowText.includes(query);
      const selectionInput = row.querySelector('input[data-sensor-id]');
      const isTicked = !!(selectionInput && selectionInput.checked);
      const matches = searchMatches && (!hideUnticked || isTicked);
      row.classList.toggle('is-search-hidden', !matches);
      row.setAttribute('aria-hidden', matches ? 'false' : 'true');
      row.draggable = matches;
      if (matches) matchingRows += 1;
    });

    const searchCollapsed = hasQuery && sensorSearchCollapsedGroups.has(groupKey);
    block.classList.toggle('is-search-hidden', hasActiveFilter && matchingRows === 0);
    block.classList.toggle('is-searching', hasQuery);
    block.classList.toggle('is-search-collapsed', searchCollapsed);

    const toggle = block.querySelector('[data-toggle-sensor-group]');
    if (toggle) {
      const persistentCollapsed = block.classList.contains('is-collapsed');
      toggle.setAttribute('aria-expanded', (hasQuery ? !searchCollapsed : !persistentCollapsed) ? 'true' : 'false');
    }

    const count = block.querySelector('.sensor-category-count');
    if (count) count.textContent = hasActiveFilter ? `${matchingRows}/${rows.length}` : String(rows.length);
    visibleSensorCount += matchingRows;
  });

  if (emptyState) {
    emptyState.textContent = hideUnticked
      ? (hasQuery ? 'No ticked sensors match your search.' : 'No ticked sensors to show.')
      : 'No sensors match your search.';
    emptyState.hidden = !hasActiveFilter || visibleSensorCount > 0;
  }
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
  saveOverlaySensorSelection();
  saveSensorCategorySelection();

  const html = SENSOR_GROUP_ORDER
    .map((group) => {
      const sensors = groupedSensors[group] || [];
      if (!sensors.length) return '';
      const groupEnabled = sensorCategorySelection[group] !== false;
      const groupLabel = SENSOR_GROUP_LABELS[group] || group;
      const items = sensors
        .map((sensor, index) => {
          const checked = sensorSelection[sensor.id] ? 'checked' : '';
          const overlayChecked = overlaySensorSelection[sensor.id] ? 'checked' : '';
          const hasAlertEnabled = !!(sensorAlertRules[sensor.id] && sensorAlertRules[sensor.id].enabled !== false);
          const disabled = groupEnabled ? '' : 'disabled';
          const label = escapeHtml(getFinalDisplayLabel(sensor));
          const hasCustomName = String(sensorCustomNames[sensor.id] || '').trim().length > 0;
          const resetNameDisabled = hasCustomName ? '' : 'disabled';
          const searchText = escapeHtml(`${groupLabel} ${sensor.name || ''} ${getFinalDisplayLabel(sensor)} ${sensor.hardwareType || ''} ${sensor.sensorType || ''} ${sensor.units || ''}`);
          return `
            <div class="sensor-item-row" draggable="true" data-order-group="${group}" data-order-sensor-id="${sensor.id}" data-sensor-search="${searchText}">
              <span class="sensor-drag-handle" title="Drag to reorder" aria-hidden="true">⋮⋮</span>
              <label class="checkbox-label sensor-item-label"><input type="checkbox" data-sensor-id="${sensor.id}" ${checked} ${disabled}><span class="sensor-name">${label}</span>${hasAlertEnabled ? '<span class="sensor-alert-enabled-indicator" title="Alert enabled">✓</span>' : ''}</label>
              <div class="sensor-item-actions">
                <label class="checkbox-label overlay-checkbox" title="Show in overlay"><input type="checkbox" data-overlay-sensor-id="${sensor.id}" ${overlayChecked} ${disabled}><span>Overlay</span></label>
                <button type="button" class="sensor-order-btn sensor-rename-btn" data-rename-sensor-id="${sensor.id}" aria-label="Rename ${label}" title="Rename sensor">✎</button>
                <button type="button" class="sensor-order-btn sensor-reset-name-btn" data-reset-sensor-name-id="${sensor.id}" aria-label="Reset ${label} name" title="Reset this sensor name" ${resetNameDisabled}><i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i></button>
              </div>
            </div>
          `;
        })
        .join('');
      const categoryChecked = groupEnabled ? 'checked' : '';
      const iconClass = SENSOR_GROUP_ICONS[group] || 'bi-circle-fill';
      const isCollapsed = sensorCategoryCollapse[group] === true;
      return `
        <div class="sensor-category-block${groupEnabled ? '' : ' is-disabled'}${isCollapsed ? ' is-collapsed' : ''}" data-sensor-group-key="${group}" data-sensor-group-search="${escapeHtml(`${group} ${groupLabel}`)}">
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
  refreshMotionVisibilityTargets(container);
  applySensorSelectionFilter();
  refreshSensorAlertEditor(groupedSensors);
}

function listAlertCandidateSensors(groupedSensors) {
  return listEnabledAlertSensors(
    groupedSensors,
    SENSOR_GROUP_ORDER,
    sensorSelection,
    sensorCategorySelection
  ).map(({ group, sensor }) => ({
        id: String(sensor.id),
        label: `${SENSOR_GROUP_LABELS[group] || group}: ${getFinalDisplayLabel(sensor)}`,
        sensor
      }));
}

function refreshSensorAlertEditor(groupedSensors) {
  const sensorSelect = document.getElementById('alertSensorSelect');
  const enabledToggle = document.getElementById('alertRuleEnabled');
  const operatorSelect = document.getElementById('alertOperatorSelect');
  const thresholdInput = document.getElementById('alertThresholdInput');
  const cooldownInput = document.getElementById('alertCooldownInput');
  const severitySelect = document.getElementById('alertSeveritySelect');
  if (!sensorSelect) return;

  const previousValue = sensorSelect.value;
  const candidates = listAlertCandidateSensors(groupedSensors);
  sensorSelect._alertCandidates = candidates;
  sensorSelect.innerHTML = '<option value="">Select sensor...</option>';
  candidates.forEach((entry) => {
    const option = document.createElement('option');
    option.value = entry.id;
    const hasAlertEnabled = !!(sensorAlertRules[entry.id] && sensorAlertRules[entry.id].enabled !== false);
    option.textContent = hasAlertEnabled ? `✅ ${entry.label}` : entry.label;
    sensorSelect.appendChild(option);
  });
  if (previousValue && candidates.some((entry) => entry.id === previousValue)) {
    sensorSelect.value = previousValue;
  }

  const applyRuleToEditor = () => {
    const sensorId = String(sensorSelect.value || '').trim();
    const currentCandidates = Array.isArray(sensorSelect._alertCandidates) ? sensorSelect._alertCandidates : [];
    const selectedSensorEntry = currentCandidates.find((entry) => entry.id === sensorId);
    if (!sensorId || !selectedSensorEntry) {
      if (enabledToggle) enabledToggle.checked = false;
      if (operatorSelect) operatorSelect.value = '>=';
      if (thresholdInput) thresholdInput.value = '';
      if (cooldownInput) cooldownInput.value = '30';
      if (severitySelect) severitySelect.value = 'warning';
      return;
    }
    const rule = normalizeSensorAlertRule(sensorAlertRules[sensorId] || getDefaultAlertRuleForSensor(selectedSensorEntry.sensor));
    if (enabledToggle) enabledToggle.checked = !!rule.enabled;
    if (operatorSelect) operatorSelect.value = rule.operator;
    if (thresholdInput) thresholdInput.value = String(rule.threshold);
    if (cooldownInput) cooldownInput.value = String(rule.cooldownSec);
    if (severitySelect) severitySelect.value = rule.severity;
  };

  if (!sensorSelect.dataset.alertEditorBound) {
    sensorSelect.addEventListener('change', applyRuleToEditor);
    sensorSelect.dataset.alertEditorBound = 'true';
  }
  applyRuleToEditor();
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

function savePersistedSensorCatalog(groupedSensors) {
  try {
    const payload = createSensorCatalogCachePayload(groupedSensors, SENSOR_GROUP_ORDER);
    localStorage.setItem(SENSOR_CATALOG_CACHE_KEY, JSON.stringify(payload));
  } catch (error) {
    // Catalog caching is only a startup convenience; live discovery remains authoritative.
  }
}

function loadPersistedSensorCatalog() {
  try {
    return parseSensorCatalogCache(localStorage.getItem(SENSOR_CATALOG_CACHE_KEY), SENSOR_GROUP_ORDER);
  } catch (error) {
    return null;
  }
}

function restorePersistedSensorCatalogForStartup() {
  if (loadProviderSelection().enhanced !== true) return;
  const restored = loadPersistedSensorCatalog();
  if (!restored || !SENSOR_GROUP_ORDER.some((group) => (restored[group] || []).length > 0)) return;

  cachedOrderedSensorCatalog = applySensorOrderToGroupedSensors(restored);
  cachedCatalogPreservingMissingSensors = true;
  sensorCatalogSignature = '';
  renderSensorOptions(cachedOrderedSensorCatalog);
  latestSelectedGroupedSensors = filterSelectedSensors(cachedOrderedSensorCatalog);
  prepareSelectedSensorsForRender(latestSelectedGroupedSensors);
  renderAllDynamicGroups(latestSelectedGroupedSensors, { force: true });
}

function rebuildCachedSensorCatalog(liveGroupedSensors, options = {}) {
  let displayNamedGrouped = createDisplayNamedGroupedSensors(liveGroupedSensors);
  if (options.preserveMissing === true) {
    displayNamedGrouped = mergeLiveAndCachedCatalog(
      displayNamedGrouped,
      cachedOrderedSensorCatalog,
      SENSOR_GROUP_ORDER
    );
  }
  const orderedGrouped = applySensorOrderToGroupedSensors(displayNamedGrouped);
  renderSensorOptions(orderedGrouped);

  const nextCache = createEmptyGroupedBuckets();
  Object.keys(orderedGrouped || {}).forEach((group) => {
    nextCache[group] = (orderedGrouped[group] || []).map((sensor) => ({ ...sensor }));
  });
  cachedOrderedSensorCatalog = nextCache;
  if (options.persist === true) savePersistedSensorCatalog(nextCache);
}

function buildSelectedSensorsFromCachedCatalog(liveGroupedSensors, options = {}) {
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
        if (!live) {
          if (options.preserveMissing !== true) return null;
          return {
            ...catalogSensor,
            value: SENSOR_DETECTING_VALUE,
            formatted: SENSOR_DETECTING_VALUE
          };
        }
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

    sourceList.forEach((sensor) => {
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

      let normalizedGroup = group;
      const lowerName = sourceName.toLowerCase();
      if (lowerName.includes('frame time') || lowerName.includes('frametime') || /\bfps\b/.test(lowerName)) {
        normalizedGroup = 'fps';
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

      const finalSensor = {
        ...normalizedSensor,
        name: getFinalDisplayLabel({ ...normalizedSensor, name: displayName })
      };

      output[normalizedGroup] = output[normalizedGroup] || [];
      output[normalizedGroup].push(finalSensor);
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
  if (!base.fps) base.fps = [];
  if (!base.latency) base.latency = [];

  // Move any existing FPS/frame-time sensors into the dedicated FPS group.
  Object.keys(base).forEach((groupKey) => {
    if (groupKey === 'fps') return;
    const list = base[groupKey] || [];
    for (let idx = list.length - 1; idx >= 0; idx -= 1) {
      const sensor = list[idx];
      const name = String(sensor && sensor.name ? sensor.name : '').toLowerCase();
      if (name.includes('frame time') || name.includes('frametime') || /\bfps\b/.test(name)) {
        base.fps.push(sensor);
        list.splice(idx, 1);
      }
    }
  });

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
    if (frameMatch.group !== 'fps') {
      base.fps.push(base[frameMatch.group][frameMatch.idx]);
      base[frameMatch.group].splice(frameMatch.idx, 1);
    }
  } else {
    const fpsIndexInFps = base.fps.findIndex((sensor) => {
      const name = String(sensor && sensor.name ? sensor.name : '').toLowerCase();
      return /\bfps\b/.test(name);
    });
    const insertIndex = fpsIndexInFps >= 0 ? fpsIndexInFps + 1 : 0;
    base.fps.splice(insertIndex, 0, frameSensorEntry);
  }

  const packetLossPct = latencyState.total > 0 ? ((latencyState.lost / latencyState.total) * 100) : 0;
  base.latency = [
    { id: 'latency_current', name: `Current (${latencyState.host})`, value: Number.isFinite(latencyState.current) ? latencyState.current : 0, units: 'ms', group: 'latency' },
    { id: 'latency_average', name: `Average (${latencyState.host})`, value: Number.isFinite(latencyState.avg) ? latencyState.avg : 0, units: 'ms', group: 'latency' },
    { id: 'latency_minimum', name: `Minimum (${latencyState.host})`, value: Number.isFinite(latencyState.min) ? latencyState.min : 0, units: 'ms', group: 'latency' },
    { id: 'latency_maximum', name: `Maximum (${latencyState.host})`, value: Number.isFinite(latencyState.max) ? latencyState.max : 0, units: 'ms', group: 'latency' },
    { id: 'latency_packet_loss', name: `Packet Loss (${latencyState.host})`, value: Number.isFinite(packetLossPct) ? packetLossPct : 0, units: '%', group: 'latency' }
  ];

  return base;
}

function updateDynamicGroupValuesInPlace(container, sensors) {
  if (summaryModeEnabled || !Array.isArray(sensors) || !sensors.length) return false;
  if (sensors.some((sensor) => expandedGraphSensors.has(sensor.id))) return false;

  const rows = Array.from(container.children);
  if (rows.length !== sensors.length || rows.some((row) => !row.classList.contains('stat'))) return false;
  // A graph may have just been collapsed. Values can only be updated in place
  // when the existing DOM already has the same non-expanded structure; otherwise
  // the old graph wrapper and expanded styling would survive until another view
  // change forced a complete render.
  if (rows.some((row) => row.classList.contains('is-expanded') || row.querySelector('.stat-graph-wrap, .stat-graph-empty'))) return false;

  for (let index = 0; index < sensors.length; index += 1) {
    const sensor = sensors[index];
    const row = rows[index];
    if (row.dataset.sensorId !== encodeURIComponent(sensor.id)) return false;

    const label = row.querySelector('.stat-label');
    const value = row.querySelector('.stat-value');
    if (!label || !value) return false;

    const nextLabel = String(sensor.displayLabel || getFinalDisplayLabel(sensor));
    const nextValue = formatSensorValue(sensor);
    if (label.textContent !== nextLabel) label.textContent = nextLabel;
    if (value.textContent !== nextValue) value.textContent = nextValue;

    const alertSeverity = activeSensorAlertState[sensor.id]?.severity || '';
    row.classList.toggle('stat-alert-warning', alertSeverity === 'warning');
    row.classList.toggle('stat-alert-critical', alertSeverity === 'critical');
  }

  return true;
}

function renderDynamicGroup(containerId, sensors) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const nextSignature = buildGroupRenderSignature(sensors);
  if (renderGroupSignatureCache[containerId] === nextSignature) return;
  if (updateDynamicGroupValuesInPlace(container, sensors)) {
    renderGroupSignatureCache[containerId] = nextSignature;
    return;
  }
  renderGroupSignatureCache[containerId] = nextSignature;

  if (!sensors || !sensors.length) {
    container.innerHTML = '<div class="stat-empty">No selected sensors</div>';
    return;
  }

  container.innerHTML = sensors
    .map((sensor) => {
      const isExpanded = expandedGraphSensors.has(sensor.id);
      const alertSeverity = activeSensorAlertState[sensor.id]?.severity || '';
      const alertClass = alertSeverity === 'critical' ? ' stat-alert-critical' : (alertSeverity === 'warning' ? ' stat-alert-warning' : '');
      const encodedId = encodeURIComponent(sensor.id);
      const graphHtml = summaryModeEnabled ? renderSensorSummary(sensor) : (isExpanded ? renderSensorGraph(sensor) : '');
      const expandedClass = isExpanded ? ' is-expanded' : '';
      const clickableClass = summaryModeEnabled ? '' : ' stat-clickable';
      const roleAttr = summaryModeEnabled ? '' : ' role="button" tabindex="0"';
      const expandedAttr = summaryModeEnabled ? '' : ` aria-expanded="${isExpanded ? 'true' : 'false'}"`;
      const mainRowHtml = summaryModeEnabled
        ? `<div class="stat-main stat-main-summary"><span class="stat-label">${escapeHtml(sensor.displayLabel || getFinalDisplayLabel(sensor))}</span></div>`
        : `<div class="stat-main"><span class="stat-label">${escapeHtml(sensor.displayLabel || getFinalDisplayLabel(sensor))}</span><span class="stat-value">${escapeHtml(formatSensorValue(sensor))}</span></div>`;

      return `
        <div class="stat${clickableClass}${expandedClass}${alertClass}" data-sensor-id="${encodedId}"${roleAttr}${expandedAttr}>
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
  prepareSelectedSensorsForRender(latestSelectedGroupedSensors || createEmptyGroupedBuckets());
  renderSensorOptions(cachedOrderedSensorCatalog);
  renderAllDynamicGroups(latestSelectedGroupedSensors || createEmptyGroupedBuckets(), { force: true });
  publishWebMonitorPayload(latestWebPayload.mode || 'builtin', latestWebPayload.external || 'N/A');
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

function resetCustomSensorName(sensorId) {
  const id = String(sensorId || '').trim();
  if (!id || !Object.prototype.hasOwnProperty.call(sensorCustomNames, id)) return;
  delete sensorCustomNames[id];
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
  background: '#1a1a1a',
  settingsPanel: '#1a1a1a',
  settingsPanelAccent: '#0066ff',
  settingsPanelIcon: '#3f95ff'
};
const LIGHT_COLOR_DEFAULTS = {
  font: '#202731',
  sensorLabel: '#526173',
  sensorValue: '#0066d9',
  icon: '#0066d9',
  graph: '#0066d9',
  blockHeader: '#0057c7',
  outline: '#c5cfdb',
  background: '#f4f7fb',
  settingsPanel: '#edf2f7',
  settingsPanelAccent: '#0066d9',
  settingsPanelIcon: '#005fc7'
};
const THEME_ACCENT_LIGHT_MAP = {
  blue: '#3f95ff',
  purple: '#b85cff',
  green: '#19db63',
  red: '#ff5959',
  cyan: '#33e7ff',
  orange: '#ffa033'
};
const THEME_ACCENT_MAP = {
  blue: '#0066ff',
  purple: '#8f2dff',
  green: '#00b84f',
  red: '#ff2d2d',
  cyan: '#00c8ff',
  orange: '#ff7a00'
};

function normalizeDisplayMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['light', 'dark', 'system'].includes(normalized) ? normalized : 'dark';
}

function getDisplayModePreference() {
  return normalizeDisplayMode(localStorage.getItem(DISPLAY_MODE_KEY) || 'dark');
}

function getSystemDisplayMode() {
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch (error) {
    return 'dark';
  }
}

function getResolvedDisplayMode(preference = getDisplayModePreference()) {
  const normalized = normalizeDisplayMode(preference);
  return normalized === 'system' ? getSystemDisplayMode() : normalized;
}

function getThemeDefaults(themeName, displayMode = getResolvedDisplayMode()) {
  const key = String(themeName || 'blue').toLowerCase();
  const isLight = displayMode === 'light';
  const base = isLight ? LIGHT_COLOR_DEFAULTS : BASE_COLOR_DEFAULTS;
  const accentLight = isLight
    ? (THEME_ACCENT_MAP[key] || base.sensorValue)
    : (THEME_ACCENT_LIGHT_MAP[key] || base.sensorValue);
  const accent = THEME_ACCENT_MAP[key] || base.blockHeader;
  return {
    ...base,
    sensorValue: accentLight,
    icon: accentLight,
    graph: accentLight,
    blockHeader: accent,
    settingsPanelAccent: accent,
    settingsPanelIcon: accentLight
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
  normalizeColors(colors, themeName, displayMode) {
    const defaults = getThemeDefaults(themeName || localStorage.getItem('theme') || 'blue', displayMode);
    const source = colors && typeof colors === 'object' ? colors : {};
    return Object.fromEntries(
      Object.keys(defaults).map((key) => [key, normalizeHexColor(source[key], defaults[key])])
    );
  },
  getPalettes(themeName) {
    const theme = themeName || localStorage.getItem('theme') || 'blue';
    let parsed = {};
    let hasSavedPalettes = false;
    try {
      const raw = localStorage.getItem(CUSTOM_COLOR_PALETTES_KEY);
      hasSavedPalettes = !!raw;
      parsed = raw ? JSON.parse(raw) : {};
    } catch (error) {
      parsed = {};
    }
    let legacyDark = {};
    try {
      legacyDark = JSON.parse(localStorage.getItem(CUSTOM_COLORS_KEY) || '{}');
    } catch (error) {
      legacyDark = {};
    }
    const palettes = {
      dark: this.normalizeColors(parsed.dark || legacyDark, theme, 'dark'),
      light: this.normalizeColors(parsed.light, theme, 'light')
    };
    if (!hasSavedPalettes) {
      localStorage.setItem(CUSTOM_COLOR_PALETTES_KEY, JSON.stringify(palettes));
    }
    return palettes;
  },
  savePalettes(palettes, themeName) {
    const theme = themeName || localStorage.getItem('theme') || 'blue';
    const normalized = {
      dark: this.normalizeColors(palettes && palettes.dark, theme, 'dark'),
      light: this.normalizeColors(palettes && palettes.light, theme, 'light')
    };
    localStorage.setItem(CUSTOM_COLOR_PALETTES_KEY, JSON.stringify(normalized));
    return normalized;
  },
  getColors(themeName, displayMode = getResolvedDisplayMode()) {
    const mode = displayMode === 'light' ? 'light' : 'dark';
    return this.getPalettes(themeName)[mode];
  },
  saveColors(colors, displayMode = getResolvedDisplayMode()) {
    const theme = localStorage.getItem('theme') || 'blue';
    const mode = displayMode === 'light' ? 'light' : 'dark';
    const palettes = this.getPalettes(theme);
    palettes[mode] = this.normalizeColors(colors, theme, mode);
    const normalizedPalettes = this.savePalettes(palettes, theme);
    const normalized = normalizedPalettes[mode];
    // Preserve the legacy key so older profile readers still receive a complete palette.
    localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(normalized));
    return normalized;
  },
  applyColors(colors, displayMode = getResolvedDisplayMode()) {
    const mode = displayMode === 'light' ? 'light' : 'dark';
    const normalized = this.normalizeColors(colors, localStorage.getItem('theme') || 'blue', mode);
    const secondaryDelta = mode === 'light' ? -8 : 19;
    const tertiaryDelta = mode === 'light' ? -17 : 32;

    document.body.style.setProperty('--text-primary', normalized.font);
    document.body.style.setProperty('--text-secondary', normalized.sensorLabel);
    document.body.style.setProperty('--sensor-label-color', normalized.sensorLabel);
    document.body.style.setProperty('--sensor-value-color', normalized.sensorValue);
    document.body.style.setProperty('--icon-color', normalized.icon);
    document.body.style.setProperty('--graph-color', normalized.graph);
    document.body.style.setProperty('--block-header-color', normalized.blockHeader);
    document.body.style.setProperty('--border-color', normalized.outline);
    document.body.style.setProperty('--bg-primary', normalized.background);
    document.body.style.setProperty('--bg-secondary', adjustHexColor(normalized.background, secondaryDelta));
    document.body.style.setProperty('--bg-tertiary', adjustHexColor(normalized.background, tertiaryDelta));
    document.body.style.setProperty('--settings-panel-color', normalized.settingsPanel);
    document.body.style.setProperty('--settings-panel-accent-color', normalized.settingsPanelAccent);
    document.body.style.setProperty('--settings-panel-icon-color', normalized.settingsPanelIcon);
    return normalized;
  },
  resetToThemeDefaults(themeName, displayMode = getResolvedDisplayMode()) {
    const defaults = getThemeDefaults(themeName || localStorage.getItem('theme') || 'blue', displayMode);
    this.saveColors(defaults, displayMode);
    this.applyColors(defaults, displayMode);
    return defaults;
  }
};

const ThemeManager = {
  setTheme(theme, options = {}) {
    const requestedTheme = String(theme || '').trim().toLowerCase();
    const normalizedTheme = Object.prototype.hasOwnProperty.call(THEME_ACCENT_MAP, requestedTheme) ? requestedTheme : 'blue';
    if (options.updatePalettes !== false) {
      const palettes = CustomColorManager.getPalettes(this.getTheme());
      ['dark', 'light'].forEach((mode) => {
        const nextDefaults = getThemeDefaults(normalizedTheme, mode);
        palettes[mode] = {
          ...palettes[mode],
          sensorValue: nextDefaults.sensorValue,
          icon: nextDefaults.icon,
          graph: nextDefaults.graph,
          blockHeader: nextDefaults.blockHeader,
          settingsPanelAccent: nextDefaults.settingsPanelAccent,
          settingsPanelIcon: nextDefaults.settingsPanelIcon
        };
      });
      CustomColorManager.savePalettes(palettes, normalizedTheme);
    }
    document.body.classList.remove('theme-blue', 'theme-purple', 'theme-green', 'theme-red', 'theme-cyan', 'theme-orange');
    document.body.classList.add(`theme-${normalizedTheme}`);
    document.querySelectorAll('.theme-btn').forEach((button) => {
      button.classList.toggle('active', button.dataset.theme === normalizedTheme);
    });
    if (options.persist !== false) localStorage.setItem('theme', normalizedTheme);
    CustomColorManager.applyColors(CustomColorManager.getColors(normalizedTheme));
  },
  getTheme() {
    return localStorage.getItem('theme') || 'blue';
  }
};

function syncCustomColorInputs(colors) {
  const inputMap = {
    customFontColor: 'font',
    customSensorNameColor: 'sensorLabel',
    customSensorValueColor: 'sensorValue',
    customIconColor: 'icon',
    customGraphColor: 'graph',
    customBlockHeaderColor: 'blockHeader',
    customOutlineColor: 'outline',
    customBackgroundColor: 'background',
    customSettingsPanelColor: 'settingsPanel',
    customSettingsPanelAccentColor: 'settingsPanelAccent',
    customSettingsPanelIconColor: 'settingsPanelIcon'
  };
  Object.entries(inputMap).forEach(([inputId, colorKey]) => {
    const input = document.getElementById(inputId);
    if (input && colors && colors[colorKey]) input.value = colors[colorKey];
  });
}

function updateCustomColorModeNote(preference, effectiveMode) {
  const note = document.getElementById('customColorModeNote');
  if (!note) return;
  const modeLabel = effectiveMode === 'light' ? 'Light' : 'Dark';
  note.textContent = preference === 'system'
    ? `Editing the ${modeLabel} palette currently selected by Windows.`
    : `Editing the ${modeLabel} palette.`;
}

const DisplayModeManager = {
  mediaQuery: null,
  mediaListener: null,
  apply(preference, options = {}) {
    const normalized = normalizeDisplayMode(preference);
    const effectiveMode = getResolvedDisplayMode(normalized);
    if (options.persist !== false) localStorage.setItem(DISPLAY_MODE_KEY, normalized);
    document.body.classList.toggle('display-light', effectiveMode === 'light');
    document.body.classList.toggle('display-dark', effectiveMode === 'dark');
    document.body.dataset.displayMode = effectiveMode;
    document.body.style.colorScheme = effectiveMode;
    document.querySelectorAll('.appearance-mode-btn').forEach((button) => {
      button.classList.toggle('active', button.dataset.displayMode === normalized);
    });
    const colors = CustomColorManager.getColors(ThemeManager.getTheme(), effectiveMode);
    CustomColorManager.applyColors(colors, effectiveMode);
    syncCustomColorInputs(colors);
    updateCustomColorModeNote(normalized, effectiveMode);
    return effectiveMode;
  },
  init() {
    this.apply(getDisplayModePreference(), { persist: false });
    if (!window.matchMedia || this.mediaQuery) return;
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    this.mediaListener = () => {
      if (getDisplayModePreference() === 'system') this.apply('system', { persist: false });
    };
    if (typeof this.mediaQuery.addEventListener === 'function') {
      this.mediaQuery.addEventListener('change', this.mediaListener);
    } else if (typeof this.mediaQuery.addListener === 'function') {
      this.mediaQuery.addListener(this.mediaListener);
    }
  }
};

const SettingsManager = {
  init() {
    sensorCustomNames = loadSensorCustomNames();
    applyAnimationSettings(loadAnimationSettings());
    setupSettingsGroupAccordion();
    setupSettingsAccordion();
    setupSettingsSearch();
    ThemeManager.setTheme(ThemeManager.getTheme(), { persist: false, updatePalettes: false });
    DisplayModeManager.init();

    const customFontColorInput = document.getElementById('customFontColor');
    const customSensorNameColorInput = document.getElementById('customSensorNameColor');
    const customSensorValueColorInput = document.getElementById('customSensorValueColor');
    const customIconColorInput = document.getElementById('customIconColor');
    const customGraphColorInput = document.getElementById('customGraphColor');
    const customBlockHeaderColorInput = document.getElementById('customBlockHeaderColor');
    const customOutlineColorInput = document.getElementById('customOutlineColor');
    const customBackgroundColorInput = document.getElementById('customBackgroundColor');
    const customSettingsPanelColorInput = document.getElementById('customSettingsPanelColor');
    const customSettingsPanelAccentColorInput = document.getElementById('customSettingsPanelAccentColor');
    const customSettingsPanelIconColorInput = document.getElementById('customSettingsPanelIconColor');
    const resetThemeColorsBtn = document.getElementById('resetThemeColorsBtn');
    let customColors = CustomColorManager.getColors();
    CustomColorManager.applyColors(customColors);

    const themeButtons = document.querySelectorAll('.theme-btn');
    themeButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        ThemeManager.setTheme(e.currentTarget.dataset.theme);
        customColors = CustomColorManager.getColors();
        syncCustomColorInputs(customColors);
      });
    });

    document.querySelectorAll('.appearance-mode-btn').forEach((button) => {
      button.addEventListener('click', (event) => {
        DisplayModeManager.apply(event.currentTarget.dataset.displayMode);
        customColors = CustomColorManager.getColors();
      });
    });

    const styleButtons = document.querySelectorAll('.style-btn');
    styleButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const nextMode = e.currentTarget?.dataset?.viewMode || 'standard';
        applyViewMode(nextMode);
      });
    });

    if (customFontColorInput && customSensorNameColorInput && customSensorValueColorInput && customIconColorInput && customGraphColorInput && customBlockHeaderColorInput && customOutlineColorInput && customBackgroundColorInput && customSettingsPanelColorInput && customSettingsPanelAccentColorInput && customSettingsPanelIconColorInput) {
      syncCustomColorInputs(customColors);

      const syncCustomColors = () => {
        const defaults = getThemeDefaults(ThemeManager.getTheme(), getResolvedDisplayMode());
        customColors = {
          font: normalizeHexColor(customFontColorInput.value, defaults.font),
          sensorLabel: normalizeHexColor(customSensorNameColorInput.value, defaults.sensorLabel),
          sensorValue: normalizeHexColor(customSensorValueColorInput.value, defaults.sensorValue),
          icon: normalizeHexColor(customIconColorInput.value, defaults.icon),
          graph: normalizeHexColor(customGraphColorInput.value, defaults.graph),
          blockHeader: normalizeHexColor(customBlockHeaderColorInput.value, defaults.blockHeader),
          outline: normalizeHexColor(customOutlineColorInput.value, defaults.outline),
          background: normalizeHexColor(customBackgroundColorInput.value, defaults.background),
          settingsPanel: normalizeHexColor(customSettingsPanelColorInput.value, defaults.settingsPanel),
          settingsPanelAccent: normalizeHexColor(customSettingsPanelAccentColorInput.value, defaults.settingsPanelAccent),
          settingsPanelIcon: normalizeHexColor(customSettingsPanelIconColorInput.value, defaults.settingsPanelIcon)
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
      customSettingsPanelColorInput.addEventListener('input', syncCustomColors);
      customSettingsPanelAccentColorInput.addEventListener('input', syncCustomColors);
      customSettingsPanelIconColorInput.addEventListener('input', syncCustomColors);

      if (resetThemeColorsBtn) {
        resetThemeColorsBtn.addEventListener('click', () => {
          const defaults = CustomColorManager.resetToThemeDefaults(ThemeManager.getTheme());
          syncCustomColorInputs(defaults);
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

    const layoutPresetSelect = document.getElementById('layoutPresetSelect');
    if (layoutPresetSelect) {
      const savedLayoutPreset = normalizeLayoutPreset(localStorage.getItem(LAYOUT_PRESET_KEY) || DEFAULT_LAYOUT_PRESET);
      applyLayoutPreset(savedLayoutPreset, { mode: 'normal', persist: true, resetCustomSizes: false });
      layoutPresetSelect.addEventListener('change', (event) => {
        const nextLayout = normalizeLayoutPreset(event.target.value);
        applyLayoutPreset(nextLayout, { mode: 'normal', persist: true, resetCustomSizes: nextLayout !== 'custom' });
      });
    }

    const summaryLayoutPresetSelect = document.getElementById('summaryLayoutPresetSelect');
    if (summaryLayoutPresetSelect) {
      const savedSummaryLayoutPreset = normalizeLayoutPreset(localStorage.getItem(SUMMARY_LAYOUT_PRESET_KEY) || DEFAULT_LAYOUT_PRESET);
      applyLayoutPreset(savedSummaryLayoutPreset, { mode: 'summary', persist: true, resetCustomSizes: false });
      summaryLayoutPresetSelect.addEventListener('change', (event) => {
        const nextLayout = normalizeLayoutPreset(event.target.value);
        applyLayoutPreset(nextLayout, { mode: 'summary', persist: true, resetCustomSizes: nextLayout !== 'custom' });
      });
    }

    const overlayGroupLineLimits = getOverlayGroupLineLimits();
    SENSOR_GROUP_ORDER.forEach((group) => {
      const input = document.getElementById(`overlayLineLimit_${group}`);
      if (!input) return;
      input.value = String(overlayGroupLineLimits[group] || 8);
      input.addEventListener('input', (e) => {
        const next = normalizeGroupLineLimit(e.target.value);
        if (String(e.target.value) !== String(next)) {
          e.target.value = String(next);
        }
        const current = getOverlayGroupLineLimits();
        current[group] = next;
        localStorage.setItem(OVERLAY_GROUP_LINE_LIMITS_KEY, JSON.stringify(current));
        refreshOverlayWindowState(localStorage.getItem(OVERLAY_ENABLED_KEY) === 'true');
      });
    });

    const overlayLineLimitsToggle = document.getElementById('overlayLineLimitsToggle');
    const overlayLineLimitsToggleText = document.getElementById('overlayLineLimitsToggleText');
    const overlayLineLimitGrid = document.getElementById('overlayLineLimitGrid');
    if (overlayLineLimitsToggle && overlayLineLimitGrid) {
      const expanded = String(localStorage.getItem(OVERLAY_LINE_LIMITS_EXPANDED_KEY) || '').toLowerCase() === 'true';
      overlayLineLimitGrid.classList.toggle('is-collapsed', !expanded);
      overlayLineLimitsToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      if (overlayLineLimitsToggleText) overlayLineLimitsToggleText.textContent = expanded ? 'Hide' : 'Show';
      overlayLineLimitsToggle.addEventListener('click', () => {
        const nextExpanded = overlayLineLimitGrid.classList.contains('is-collapsed');
        overlayLineLimitGrid.classList.toggle('is-collapsed', !nextExpanded);
        overlayLineLimitsToggle.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
        if (overlayLineLimitsToggleText) overlayLineLimitsToggleText.textContent = nextExpanded ? 'Hide' : 'Show';
        localStorage.setItem(OVERLAY_LINE_LIMITS_EXPANDED_KEY, nextExpanded ? 'true' : 'false');
      });
    }

    const overlayCategoryOrderList = document.getElementById('overlayCategoryOrderList');
    const overlayCategoryOrderReset = document.getElementById('overlayCategoryOrderReset');
    if (overlayCategoryOrderList) {
      let overlayCategoryOrder = loadOverlayCategoryOrder();
      let overlayOrderDragging = '';
      let overlayOrderDropTarget = '';
      let overlayOrderPlaceAfter = false;
      renderOverlayCategoryOrderEditor(overlayCategoryOrder);

      const clearOverlayOrderDragClasses = () => {
        overlayCategoryOrderList.querySelectorAll('.overlay-category-order-item.dragging, .overlay-category-order-item.drag-over-before, .overlay-category-order-item.drag-over-after').forEach((row) => {
          row.classList.remove('dragging', 'drag-over-before', 'drag-over-after');
        });
      };

      const persistAndRefresh = () => {
        overlayCategoryOrder = saveOverlayCategoryOrder(overlayCategoryOrder);
        renderOverlayCategoryOrderEditor(overlayCategoryOrder);
        sendOverlayPayload(getOverlaySensorPayload(latestSelectedGroupedSensors || createEmptyGroupedBuckets()));
      };

      overlayCategoryOrderList.addEventListener('dragstart', (event) => {
        const item = event.target.closest('[data-overlay-category-order]');
        if (!item || !event.dataTransfer) return;
        overlayOrderDragging = String(item.dataset.overlayCategoryOrder || '').trim().toLowerCase();
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', overlayOrderDragging);
        overlayOrderDropTarget = '';
        overlayOrderPlaceAfter = false;
        item.classList.add('dragging');
      });

      overlayCategoryOrderList.addEventListener('dragend', (event) => {
        overlayOrderDragging = '';
        overlayOrderDropTarget = '';
        overlayOrderPlaceAfter = false;
        clearOverlayOrderDragClasses();
      });

      overlayCategoryOrderList.addEventListener('dragover', (event) => {
        event.preventDefault();
        const dragged = String(overlayOrderDragging || '').trim().toLowerCase();
        const targetEl = event.target.closest('[data-overlay-category-order]');
        const target = targetEl ? String(targetEl.dataset.overlayCategoryOrder || '').trim().toLowerCase() : '';
        if (!dragged || !target || dragged === target || !targetEl) return;
        const rect = targetEl.getBoundingClientRect();
        const placeAfter = (event.clientY - rect.top) > (rect.height / 2);

        clearOverlayOrderDragClasses();
        overlayCategoryOrderList.querySelector(`.overlay-category-order-item[data-overlay-category-order="${dragged}"]`)?.classList.add('dragging');
        targetEl.classList.add(placeAfter ? 'drag-over-after' : 'drag-over-before');
        overlayOrderDropTarget = target;
        overlayOrderPlaceAfter = placeAfter;
      });

      overlayCategoryOrderList.addEventListener('dragleave', (event) => {
        if (event.currentTarget !== event.target) return;
        clearOverlayOrderDragClasses();
      });

      overlayCategoryOrderList.addEventListener('drop', (event) => {
        event.preventDefault();
        const dragged = String(overlayOrderDragging || '').trim().toLowerCase();
        const target = String(overlayOrderDropTarget || '').trim().toLowerCase();
        if (!dragged || !target || dragged === target) {
          clearOverlayOrderDragClasses();
          return;
        }

        const next = [...overlayCategoryOrder];
        const from = next.indexOf(dragged);
        const to = next.indexOf(target);
        if (from < 0 || to < 0) {
          clearOverlayOrderDragClasses();
          return;
        }
        next.splice(from, 1);
        const adjustedTarget = Math.max(0, Math.min(next.length, to + (overlayOrderPlaceAfter ? 1 : 0) - (from < to ? 1 : 0)));
        next.splice(adjustedTarget, 0, dragged);
        overlayCategoryOrder = next;
        overlayOrderDragging = '';
        overlayOrderDropTarget = '';
        overlayOrderPlaceAfter = false;
        clearOverlayOrderDragClasses();
        persistAndRefresh();
      });

      if (overlayCategoryOrderReset) {
        overlayCategoryOrderReset.addEventListener('click', () => {
          overlayCategoryOrder = [...SENSOR_GROUP_ORDER];
          persistAndRefresh();
        });
      }
    }

    const latencyHostInput = document.getElementById('latencyHost');
    if (latencyHostInput) {
      const host = normalizeLatencyHost(localStorage.getItem(LATENCY_HOST_KEY));
      latencyHostInput.value = host;
      localStorage.setItem(LATENCY_HOST_KEY, host);
      latencyHostInput.addEventListener('change', (e) => {
        const nextHost = normalizeLatencyHost(e.target.value);
        e.target.value = nextHost;
        localStorage.setItem(LATENCY_HOST_KEY, nextHost);
        latencyState.host = nextHost;
        latencyState.samples = [];
        latencyState.total = 0;
        latencyState.lost = 0;
        latencyState.current = null;
        latencyState.min = null;
        latencyState.max = null;
        latencyState.avg = null;
      });
    }

    // Visibility checkboxes
    const visibilityCheckboxes = {
      showFps: 'fpsGroup',
      showCpu: 'cpuGroup',
      showGpu: 'gpuGroup',
      showRam: 'ramGroup',
      showPsu: 'psuGroup',
      showFans: 'fansGroup',
      showNetwork: 'networkGroup',
      showLatency: 'latencyGroup',
      showDrives: 'drivesGroup',
      showApp: 'appGroup',
      showExternal: 'externalGroup'
    };

    localStorage.setItem('detectionMode', 'builtin');

    const setupGuideHeaderBtn = document.getElementById('setupGuideHeaderBtn');
    if (setupGuideHeaderBtn) {
      setupGuideHeaderBtn.addEventListener('click', () => {
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

    if (exportSettingsBtn) {
      exportSettingsBtn.addEventListener('click', () => {
        try {
          const payload = buildSettingsSnapshot();

          const blob = new Blob([JSON.stringify({ formatVersion: 2, appVersion: APP_VERSION, exportedAt: Date.now(), data: payload }, null, 2)], { type: 'application/json' });
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
              const data = normalizeEnhancedAdministratorSnapshot(parsed && parsed.data ? parsed.data : parsed);

              // prepare a summary for the modal
              const summary = {};
              try {
                if (data.theme) summary.theme = String(data.theme).replace(/^\"|\"$/g, '');
                if (data[VIEW_MODE_KEY]) summary.viewMode = String(data[VIEW_MODE_KEY]).replace(/^\"|\"$/g, '');
                if (data[LAYOUT_PRESET_KEY]) summary.layout = String(data[LAYOUT_PRESET_KEY]).replace(/^\"|\"$/g, '');
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

    const disableGlowEffectsToggle = document.getElementById('disableGlowEffectsToggle');
    if (disableGlowEffectsToggle) {
      const disableGlow = localStorage.getItem(DISABLE_GLOW_EFFECTS_KEY) === 'true';
      disableGlowEffectsToggle.checked = disableGlow;
      applyDisableGlowEffects(disableGlow);
      disableGlowEffectsToggle.addEventListener('change', (e) => {
        applyDisableGlowEffects(!!e.target.checked);
      });
    }

    initializeAnimationSettingsControls();

    const overlayEnabledToggle = document.getElementById('overlayEnabledToggle');
    const overlayFontSizeSlider = document.getElementById('overlayFontSizeSlider');
    const overlayFontSizeValue = document.getElementById('overlayFontSizeValue');
    const overlayFontFamilySelect = document.getElementById('overlayFontFamilySelect');
    const overlayPositionSelect = document.getElementById('overlayPositionSelect');
    const overlayStyleSelect = document.getElementById('overlayStyleSelect');
    const overlayGroupSpacingInput = document.getElementById('overlayGroupSpacing');
    const overlayShowUnitsToggle = document.getElementById('overlayShowUnitsToggle');
    const overlayTextColorInput = document.getElementById('overlayTextColor');
    const overlayValueColorInput = document.getElementById('overlayValueColor');
    const overlayBgColorInput = document.getElementById('overlayBackgroundColor');
    const overlayWidthSelect = document.getElementById('overlayWidthSelect');
    const overlayWidthInput = document.getElementById('overlayWidthInput');
    const overlayOpacityInput = document.getElementById('overlayOpacity');
    const overlayDragUnlockToggle = document.getElementById('overlayDragUnlockToggle');

    if (overlayEnabledToggle) {
      overlayEnabledToggle.checked = localStorage.getItem(OVERLAY_ENABLED_KEY) === 'true';
      overlayEnabledToggle.addEventListener('change', (e) => {
        const enabled = !!e.target.checked;
        saveOverlaySetting(OVERLAY_ENABLED_KEY, enabled ? 'true' : 'false');
        updateOverlayToggleButton(enabled);
        refreshOverlayWindowState(enabled);
      });
    }

    if (overlayFontSizeSlider) {
      const currentFontSize = normalizeOverlayFontSize(localStorage.getItem(OVERLAY_FONT_SIZE_KEY));
      overlayFontSizeSlider.value = String(overlayFontSizeToStep(currentFontSize));
      if (overlayFontSizeValue) overlayFontSizeValue.textContent = overlayFontSizeLabel(currentFontSize);
      overlayFontSizeSlider.addEventListener('input', (e) => {
        const nextSize = overlayFontSizeFromStep(e.target.value);
        if (overlayFontSizeValue) overlayFontSizeValue.textContent = overlayFontSizeLabel(nextSize);
        saveOverlaySetting(OVERLAY_FONT_SIZE_KEY, nextSize);
        refreshOverlayWindowState(overlayEnabledToggle && overlayEnabledToggle.checked);
      });
    }

    const settingsProfileSelect = document.getElementById('settingsProfileSelect');
    const settingsProfileNameInput = document.getElementById('settingsProfileNameInput');
    const saveSettingsProfileBtn = document.getElementById('saveSettingsProfileBtn');
    const applySettingsProfileBtn = document.getElementById('applySettingsProfileBtn');
    const renameSettingsProfileBtn = document.getElementById('renameSettingsProfileBtn');
    const deleteSettingsProfileBtn = document.getElementById('deleteSettingsProfileBtn');

    const renderSettingsProfiles = () => {
      if (!settingsProfileSelect) return;
      const profiles = loadSettingsProfiles();
      const names = Object.keys(profiles).sort((a, b) => a.localeCompare(b));
      const active = normalizeProfileName(localStorage.getItem(ACTIVE_SETTINGS_PROFILE_KEY) || '');

      settingsProfileSelect.innerHTML = '';
      if (!names.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No profiles saved';
        settingsProfileSelect.appendChild(option);
      } else {
        names.forEach((name) => {
          const option = document.createElement('option');
          option.value = name;
          option.textContent = name;
          settingsProfileSelect.appendChild(option);
        });
      }

      if (active && names.includes(active)) {
        settingsProfileSelect.value = active;
      } else if (names.length) {
        settingsProfileSelect.value = names[0];
      }
      if (settingsProfileNameInput && settingsProfileSelect.value) {
        settingsProfileNameInput.value = settingsProfileSelect.value;
      }
    };

    if (settingsProfileSelect) {
      settingsProfileSelect.addEventListener('change', () => {
        const selected = normalizeProfileName(settingsProfileSelect.value);
        if (selected) {
          localStorage.setItem(ACTIVE_SETTINGS_PROFILE_KEY, selected);
          if (settingsProfileNameInput) settingsProfileNameInput.value = selected;
        }
      });
      renderSettingsProfiles();
    }

    if (saveSettingsProfileBtn) {
      saveSettingsProfileBtn.addEventListener('click', async () => {
        try {
          const typedName = normalizeProfileName(settingsProfileNameInput ? settingsProfileNameInput.value : '');
          let name = typedName;
          if (!name) {
            const stamp = new Date().toISOString().replace(/[^\d]/g, '').slice(0, 14);
            name = `Profile ${stamp}`;
          }
          if (!name) {
            await showThemedMessage('Invalid Profile Name', 'Please enter a valid profile name.', {
              icon: 'bi-exclamation-triangle-fill',
              tone: 'error'
            });
            return;
          }

          const profiles = loadSettingsProfiles();
          profiles[name] = {
            formatVersion: 2,
            appVersion: APP_VERSION,
            updatedAt: Date.now(),
            snapshot: buildSettingsSnapshot()
          };
          saveSettingsProfiles(profiles);
          localStorage.setItem(ACTIVE_SETTINGS_PROFILE_KEY, name);
          renderSettingsProfiles();
          if (settingsProfileSelect) settingsProfileSelect.value = name;
          await showThemedMessage('Profile Saved', `Profile "${name}" was saved successfully.`, {
            icon: 'bi-check-circle-fill',
            tone: 'success',
            confirmLabel: 'Done'
          });
        } catch (error) {
          console.error('Failed to save profile:', error);
          await showThemedMessage('Profile Save Failed', 'Failed to save profile: ' + (error && error.message ? error.message : String(error)), {
            icon: 'bi-exclamation-octagon-fill',
            tone: 'error'
          });
        }
        const summaryReset = document.getElementById('summaryResetToggle');
        if (summaryReset) {
          summaryReset.addEventListener('click', async () => {
            const tokenSuffix = authToken ? ('?token=' + encodeURIComponent(authToken)) : '';
            const response = await fetch('/api/session/reset' + tokenSuffix, { method: 'POST', cache: 'no-store' });
            if (!response.ok) throw new Error('Unable to reset session statistics');
            domState.structureKey = '';
            load();
          });
        }
      });
    }

    if (applySettingsProfileBtn) {
      applySettingsProfileBtn.addEventListener('click', async () => {
        const selected = normalizeProfileName(settingsProfileSelect ? settingsProfileSelect.value : '');
        if (!selected) {
          await showThemedMessage('No Profile Selected', 'Select a profile first.', {
            icon: 'bi-info-circle-fill'
          });
          return;
        }

        const profiles = loadSettingsProfiles();
        const profile = profiles[selected];
        if (!profile || !profile.snapshot || typeof profile.snapshot !== 'object') {
          await showThemedMessage('Invalid Profile', 'The selected profile is invalid or is missing its saved settings.', {
            icon: 'bi-exclamation-triangle-fill',
            tone: 'error'
          });
          return;
        }
        const profileSnapshot = normalizeEnhancedAdministratorSnapshot(profile.snapshot);
        if (JSON.stringify(profileSnapshot) !== JSON.stringify(profile.snapshot)) {
          profile.snapshot = profileSnapshot;
          profile.updatedAt = Date.now();
          saveSettingsProfiles(profiles);
        }

        if (settingsSnapshotMatchesCurrent(profileSnapshot)) {
          localStorage.setItem(ACTIVE_SETTINGS_PROFILE_KEY, selected);
          return;
        }

        Object.keys(profileSnapshot).forEach((k) => {
          try {
            const v = profileSnapshot[k];
            if (v === null || v === undefined) {
              localStorage.removeItem(k);
            } else {
              localStorage.setItem(k, String(v));
            }
          } catch (e) {}
        });
        await persistCrossProcessSettingsFromSnapshot(profileSnapshot);
        localStorage.setItem(ACTIVE_SETTINGS_PROFILE_KEY, selected);
        await prepareSensorCollectorForReload();
        location.reload();
      });
    }

    if (renameSettingsProfileBtn) {
      renameSettingsProfileBtn.addEventListener('click', async () => {
        const selected = normalizeProfileName(settingsProfileSelect ? settingsProfileSelect.value : '');
        if (!selected) {
          await showThemedMessage('No Profile Selected', 'Select a profile first.', {
            icon: 'bi-info-circle-fill'
          });
          return;
        }

        const nextName = normalizeProfileName(settingsProfileNameInput ? settingsProfileNameInput.value : '');
        if (!nextName) {
          await showThemedMessage('Invalid Profile Name', 'Enter a new profile name in the profile name box.', {
            icon: 'bi-exclamation-triangle-fill',
            tone: 'error'
          });
          return;
        }

        const profiles = loadSettingsProfiles();
        const existing = profiles[selected];
        if (!existing) {
          await showThemedMessage('Profile Not Found', 'The selected profile no longer exists.', {
            icon: 'bi-exclamation-triangle-fill',
            tone: 'error'
          });
          renderSettingsProfiles();
          return;
        }

        if (nextName !== selected && profiles[nextName]) {
          await showThemedMessage('Profile Name In Use', 'A profile with that name already exists.', {
            icon: 'bi-exclamation-triangle-fill',
            tone: 'error'
          });
          return;
        }

        delete profiles[selected];
        profiles[nextName] = existing;
        profiles[nextName].updatedAt = Date.now();
        saveSettingsProfiles(profiles);
        localStorage.setItem(ACTIVE_SETTINGS_PROFILE_KEY, nextName);
        renderSettingsProfiles();
        if (settingsProfileNameInput) settingsProfileNameInput.value = nextName;
        await showThemedMessage('Profile Renamed', `Profile renamed to "${nextName}".`, {
          icon: 'bi-check-circle-fill',
          tone: 'success',
          confirmLabel: 'Done'
        });
      });
    }

    if (deleteSettingsProfileBtn) {
      deleteSettingsProfileBtn.addEventListener('click', async () => {
        const selected = normalizeProfileName(settingsProfileSelect ? settingsProfileSelect.value : '');
        if (!selected) {
          await showThemedMessage('No Profile Selected', 'Select a profile first.', {
            icon: 'bi-info-circle-fill'
          });
          return;
        }
        const confirmed = await showThemedConfirmation('Delete Profile?', `Delete profile "${selected}"? This cannot be undone.`, {
          icon: 'bi-trash3-fill',
          tone: 'warning',
          confirmLabel: 'Delete Profile',
          cancelLabel: 'Keep Profile'
        });
        if (!confirmed) return;

        const profiles = loadSettingsProfiles();
        if (profiles[selected]) delete profiles[selected];
        saveSettingsProfiles(profiles);
        if (localStorage.getItem(ACTIVE_SETTINGS_PROFILE_KEY) === selected) {
          localStorage.removeItem(ACTIVE_SETTINGS_PROFILE_KEY);
        }
        renderSettingsProfiles();
      });
    }

    if (overlayFontFamilySelect) {
      overlayFontFamilySelect.value = normalizeOverlayFontFamily(localStorage.getItem(OVERLAY_FONT_FAMILY_KEY));
      overlayFontFamilySelect.addEventListener('change', (e) => {
        saveOverlaySetting(OVERLAY_FONT_FAMILY_KEY, normalizeOverlayFontFamily(e.target.value));
        refreshOverlayWindowState(overlayEnabledToggle && overlayEnabledToggle.checked);
      });
    }

    const overlayFontBoldToggle = document.getElementById('overlayFontBoldToggle');
    if (overlayFontBoldToggle) {
      overlayFontBoldToggle.checked = normalizeOverlayFontBold(localStorage.getItem(OVERLAY_FONT_BOLD_KEY));
      overlayFontBoldToggle.addEventListener('change', (e) => {
        saveOverlaySetting(OVERLAY_FONT_BOLD_KEY, e.target.checked ? 'true' : 'false');
        refreshOverlayWindowState(overlayEnabledToggle && overlayEnabledToggle.checked);
      });
    }

    if (overlayTextColorInput) {
      overlayTextColorInput.value = normalizeOverlayColor(localStorage.getItem(OVERLAY_TEXT_COLOR_KEY), '#e0e0e0');
      overlayTextColorInput.addEventListener('input', (e) => {
        saveOverlaySetting(OVERLAY_TEXT_COLOR_KEY, normalizeOverlayColor(e.target.value, '#e0e0e0'));
        refreshOverlayWindowState(overlayEnabledToggle && overlayEnabledToggle.checked);
      });
    }

    if (overlayValueColorInput) {
      overlayValueColorInput.value = normalizeOverlayColor(localStorage.getItem(OVERLAY_VALUE_COLOR_KEY), '#ffffff');
      overlayValueColorInput.addEventListener('input', (e) => {
        saveOverlaySetting(OVERLAY_VALUE_COLOR_KEY, normalizeOverlayColor(e.target.value, '#ffffff'));
        refreshOverlayWindowState(overlayEnabledToggle && overlayEnabledToggle.checked);
      });
    }

    if (overlayBgColorInput) {
      overlayBgColorInput.value = normalizeOverlayColor(localStorage.getItem(OVERLAY_BG_COLOR_KEY), '#000000');
      overlayBgColorInput.addEventListener('input', (e) => {
        saveOverlaySetting(OVERLAY_BG_COLOR_KEY, normalizeOverlayColor(e.target.value, '#000000'));
        refreshOverlayWindowState(overlayEnabledToggle && overlayEnabledToggle.checked);
      });
    }

    if (overlayWidthSelect) {
      overlayWidthSelect.value = normalizeOverlayWidthPreset(localStorage.getItem(OVERLAY_WIDTH_PRESET_KEY));
      overlayWidthSelect.addEventListener('change', (e) => {
        const preset = normalizeOverlayWidthPreset(e.target.value);
        saveOverlaySetting(OVERLAY_WIDTH_PRESET_KEY, preset);
        const width = normalizeOverlayWidth(localStorage.getItem(OVERLAY_WIDTH_KEY), preset);
        if (overlayWidthInput) {
          overlayWidthInput.value = String(width);
          overlayWidthInput.disabled = preset !== 'custom';
        }
        refreshOverlayWindowState(overlayEnabledToggle && overlayEnabledToggle.checked);
      });
    }

    if (overlayPositionSelect) {
      overlayPositionSelect.value = normalizeOverlayPosition(localStorage.getItem(OVERLAY_POSITION_KEY));
      overlayPositionSelect.addEventListener('change', (e) => {
        const position = normalizeOverlayPosition(e.target.value);
        saveOverlaySetting(OVERLAY_POSITION_KEY, position);
        saveOverlaySetting(OVERLAY_CUSTOM_POSITION_ENABLED_KEY, 'false');
        refreshOverlayWindowState(overlayEnabledToggle && overlayEnabledToggle.checked);
      });
    }

    if (overlayStyleSelect) {
      overlayStyleSelect.value = normalizeOverlayStyle(localStorage.getItem(OVERLAY_STYLE_KEY));
      overlayStyleSelect.addEventListener('change', (e) => {
        const style = normalizeOverlayStyle(e.target.value);
        saveOverlaySetting(OVERLAY_STYLE_KEY, style);
        refreshOverlayWindowState(overlayEnabledToggle && overlayEnabledToggle.checked);
      });
    }

    const overlayMonitorSelect = document.getElementById('overlayMonitorSelect');
    if (overlayMonitorSelect) {
      ipcRenderer.invoke('overlay:get-displays').then((displays) => {
        if (!Array.isArray(displays)) return;
        const savedDisplay = localStorage.getItem(OVERLAY_MONITOR_KEY) || '';
        overlayMonitorSelect.innerHTML = '';
        displays.forEach((display) => {
          const option = document.createElement('option');
          option.value = String(display.id);
          option.textContent = display.name || `Display ${display.id}`;
          overlayMonitorSelect.appendChild(option);
        });
        overlayMonitorSelect.value = savedDisplay || (displays[0] ? String(displays[0].id) : '');
      }).catch(() => {});
      overlayMonitorSelect.addEventListener('change', (e) => {
        const displayId = String(e.target.value || '');
        saveOverlaySetting(OVERLAY_MONITOR_KEY, displayId);
        refreshOverlayWindowState(overlayEnabledToggle && overlayEnabledToggle.checked);
      });
    }

    if (overlayShowUnitsToggle) {
      overlayShowUnitsToggle.checked = normalizeOverlayShowUnits(localStorage.getItem(OVERLAY_SHOW_UNITS_KEY));
      overlayShowUnitsToggle.addEventListener('change', (e) => {
        const enabled = !!e.target.checked;
        saveOverlaySetting(OVERLAY_SHOW_UNITS_KEY, enabled ? 'true' : 'false');
        refreshOverlayWindowState(overlayEnabledToggle && overlayEnabledToggle.checked);
      });
    }
    if (overlayDragUnlockToggle) {
      overlayDragUnlockToggle.checked = normalizeOverlayDragUnlock(localStorage.getItem(OVERLAY_DRAG_UNLOCK_KEY));
      overlayDragUnlockToggle.addEventListener('change', (e) => {
        const enabled = !!e.target.checked;
        saveOverlaySetting(OVERLAY_DRAG_UNLOCK_KEY, enabled ? 'true' : 'false');
        if (ipcRenderer && typeof ipcRenderer.invoke === 'function') {
          ipcRenderer.invoke('overlay:set-drag-enabled', enabled).catch(() => {});
        }
        refreshOverlayWindowState(overlayEnabledToggle && overlayEnabledToggle.checked);
      });
    }
    if (overlayWidthInput) {
      overlayWidthInput.value = String(normalizeOverlayWidth(localStorage.getItem(OVERLAY_WIDTH_KEY), normalizeOverlayWidthPreset(localStorage.getItem(OVERLAY_WIDTH_PRESET_KEY))));
      overlayWidthInput.addEventListener('input', (e) => {
        const preset = overlayWidthSelect ? overlayWidthSelect.value : 'custom';
        if (preset === 'custom') {
          saveOverlaySetting(OVERLAY_WIDTH_KEY, normalizeOverlayWidth(e.target.value, 'custom'));
        }
        refreshOverlayWindowState(overlayEnabledToggle && overlayEnabledToggle.checked);
      });
    }

    if (overlayOpacityInput) {
      const initialOpacity = normalizeOverlayOpacity(localStorage.getItem(OVERLAY_OPACITY_KEY));
      const overlayOpacityValue = document.getElementById('overlayOpacityValue');
      overlayOpacityInput.value = String(initialOpacity);
      if (overlayOpacityValue) overlayOpacityValue.textContent = `${initialOpacity}%`;
      overlayOpacityInput.addEventListener('input', (e) => {
        const nextOpacity = normalizeOverlayOpacity(e.target.value);
        saveOverlaySetting(OVERLAY_OPACITY_KEY, nextOpacity);
        if (overlayOpacityValue) overlayOpacityValue.textContent = `${nextOpacity}%`;
        refreshOverlayWindowState(overlayEnabledToggle && overlayEnabledToggle.checked);
      });
    }

    if (overlayGroupSpacingInput) {
      const initialGroupSpacing = normalizeOverlayGroupSpacing(localStorage.getItem(OVERLAY_GROUP_SPACING_KEY));
      const overlayGroupSpacingValue = document.getElementById('overlayGroupSpacingValue');
      overlayGroupSpacingInput.value = String(initialGroupSpacing);
      if (overlayGroupSpacingValue) overlayGroupSpacingValue.textContent = `${initialGroupSpacing} px`;
      overlayGroupSpacingInput.addEventListener('input', (e) => {
        const nextGroupSpacing = normalizeOverlayGroupSpacing(e.target.value);
        saveOverlaySetting(OVERLAY_GROUP_SPACING_KEY, nextGroupSpacing);
        if (overlayGroupSpacingValue) overlayGroupSpacingValue.textContent = `${nextGroupSpacing} px`;
        refreshOverlayWindowState(overlayEnabledToggle && overlayEnabledToggle.checked);
      });
    }

    const overlayScaleInput = document.getElementById('overlayScale');
    if (overlayScaleInput) {
      const initialScale = normalizeOverlayScale(localStorage.getItem(OVERLAY_SCALE_KEY));
      const overlayScaleValue = document.getElementById('overlayScaleValue');
      overlayScaleInput.value = String(initialScale);
      if (overlayScaleValue) overlayScaleValue.textContent = `${initialScale}%`;
      overlayScaleInput.addEventListener('input', (e) => {
        const nextScale = normalizeOverlayScale(e.target.value);
        saveOverlaySetting(OVERLAY_SCALE_KEY, nextScale);
        if (overlayScaleValue) overlayScaleValue.textContent = `${nextScale}%`;
        refreshOverlayWindowState(overlayEnabledToggle && overlayEnabledToggle.checked);
      });
    }

    const overlayHotkeyInput = document.getElementById('overlayHotkey');
    if (overlayHotkeyInput) {
      const initialHotkey = String(normalizeOverlayHotkey(localStorage.getItem(OVERLAY_HOTKEY_KEY)));
      overlayHotkeyInput.value = initialHotkey;
      if (initialHotkey && ipcRenderer && ipcRenderer.invoke) {
        ipcRenderer.invoke('overlay:update-hotkey', initialHotkey).catch(() => {});
      }

      // Prevent default input behavior and capture key combinations
      overlayHotkeyInput.addEventListener('keydown', (e) => {
        e.preventDefault();

        const modifiers = [];
        if (e.ctrlKey) modifiers.push('Ctrl');
        if (e.altKey) modifiers.push('Alt');
        if (e.shiftKey) modifiers.push('Shift');
        if (e.metaKey) modifiers.push('Meta');

        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

        let key = '';
        if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
        else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
        else if (/^Numpad[0-9]$/.test(e.code)) key = `num${e.code.slice(6)}`;
        else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.code)) key = e.code;
        else if (e.code === 'NumpadAdd') key = 'numadd';
        else if (e.code === 'NumpadSubtract') key = 'numsub';
        else if (e.code === 'NumpadMultiply') key = 'nummult';
        else if (e.code === 'NumpadDivide') key = 'numdiv';
        else if (e.code === 'NumpadDecimal') key = 'numdec';
        else if (e.code === 'Space') key = 'Space';
        else key = e.key;
        if (key === ' ') key = 'Space';

        const hotkey = [...modifiers, key].join('+');
        const normalized = normalizeOverlayHotkey(hotkey);

        if (normalized) {
          overlayHotkeyInput.value = normalized;
          saveOverlaySetting(OVERLAY_HOTKEY_KEY, normalized);
          if (ipcRenderer && ipcRenderer.invoke) {
            ipcRenderer.invoke('overlay:update-hotkey', normalized).catch(() => {});
          }
        }
      });

      // Prevent typing in the input field
      overlayHotkeyInput.addEventListener('keypress', (e) => {
        e.preventDefault();
      });

      overlayHotkeyInput.addEventListener('paste', (e) => {
        e.preventDefault();
      });
    }

    // Overlay toggle button in header
    const overlayToggleBtn = document.getElementById('overlayToggleBtn');
    if (overlayToggleBtn) {
      overlayToggleBtn.addEventListener('click', async () => {
        const currentEnabled = localStorage.getItem(OVERLAY_ENABLED_KEY) === 'true';
        const newEnabled = !currentEnabled;
        saveOverlaySetting(OVERLAY_ENABLED_KEY, newEnabled ? 'true' : 'false');
        if (overlayEnabledToggle) overlayEnabledToggle.checked = newEnabled;
        updateOverlayToggleButton(newEnabled);
        refreshOverlayWindowState(newEnabled);
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

    // Built-in and optional shared-memory provider toggles
    const providerSelection = loadProviderSelection();
    const providerCheckboxes = {
      providerBuiltin: 'builtin',
      providerEnhanced: 'enhanced',
      providerRTSS: 'rtss',
      providerAIDA64: 'aida64',
      providerHWiNFO: 'hwinfo'
    };
    const hardwareAccessDriverStatus = document.getElementById('hardwareAccessDriverStatus');
    const hardwareAccessDriverInstallBtn = document.getElementById('hardwareAccessDriverInstallBtn');
    let hardwareAccessStatusRequest = 0;

    const refreshHardwareAccessDriverUi = async () => {
      if (!hardwareAccessDriverStatus || !ipcRenderer || typeof ipcRenderer.invoke !== 'function') return;
      const requestId = ++hardwareAccessStatusRequest;
      try {
        const status = await ipcRenderer.invoke('hardware-access:get-status');
        if (requestId !== hardwareAccessStatusRequest) return;
        const enhancedEnabled = loadProviderSelection().enhanced === true;
        if (status && status.compatible) {
          hardwareAccessDriverStatus.textContent = `Low-level hardware access driver: Ready${status.version ? ` (PawnIO ${status.version})` : ''}.`;
          hardwareAccessDriverStatus.classList.remove('web-status-error');
          if (hardwareAccessDriverInstallBtn) hardwareAccessDriverInstallBtn.hidden = true;
          return;
        }

        const detail = status && status.error
          ? ` ${status.error}`
          : ' Intel CPU package power and some protected motherboard readings may be unavailable.';
        hardwareAccessDriverStatus.textContent = `Low-level hardware access driver: Not ready.${detail}`;
        hardwareAccessDriverStatus.classList.toggle('web-status-error', enhancedEnabled);
        if (hardwareAccessDriverInstallBtn) {
          hardwareAccessDriverInstallBtn.hidden = !enhancedEnabled;
          hardwareAccessDriverInstallBtn.disabled = !(status && status.installerAvailable);
          hardwareAccessDriverInstallBtn.textContent = status && status.installed
            ? 'Update Hardware Access Driver'
            : 'Install Hardware Access Driver';
        }
      } catch (error) {
        if (requestId !== hardwareAccessStatusRequest) return;
        hardwareAccessDriverStatus.textContent = `Low-level hardware access driver status unavailable: ${error.message}`;
        hardwareAccessDriverStatus.classList.add('web-status-error');
        if (hardwareAccessDriverInstallBtn) hardwareAccessDriverInstallBtn.hidden = true;
      }
    };

    if (hardwareAccessDriverInstallBtn) {
      hardwareAccessDriverInstallBtn.addEventListener('click', async () => {
        hardwareAccessDriverInstallBtn.disabled = true;
        if (hardwareAccessDriverStatus) {
          hardwareAccessDriverStatus.textContent = 'Restarting with administrator privileges to install the hardware access driver...';
          hardwareAccessDriverStatus.classList.remove('web-status-error');
        }
        try {
          const restartResult = await ipcRenderer.invoke('app:restart-elevated', {
            enableLaunchAsAdministrator: true,
            installHardwareAccessDriver: true
          });
          if (!restartResult || restartResult.ok !== true) {
            hardwareAccessDriverInstallBtn.disabled = false;
            if (hardwareAccessDriverStatus) {
              hardwareAccessDriverStatus.textContent = restartResult?.error || 'The hardware access driver installation was cancelled.';
              hardwareAccessDriverStatus.classList.add('web-status-error');
            }
          }
        } catch (error) {
          hardwareAccessDriverInstallBtn.disabled = false;
          if (hardwareAccessDriverStatus) {
            hardwareAccessDriverStatus.textContent = `Unable to start the hardware access driver installation: ${error.message}`;
            hardwareAccessDriverStatus.classList.add('web-status-error');
          }
        }
      });
    }

    Object.entries(providerCheckboxes).forEach(([elementId, providerKey]) => {
      const checkbox = document.getElementById(elementId);
      if (!checkbox) return;
      checkbox.checked = providerSelection[providerKey] !== false;
      checkbox.addEventListener('change', async () => {
        const nextSelection = loadProviderSelection();

        if (providerKey === 'enhanced' && checkbox.checked && nextSelection.enhanced !== true) {
          const confirmed = await showEnhancedSensorsConfirmation();

          if (!confirmed) {
            checkbox.checked = false;
            return;
          }

          nextSelection.enhanced = true;
          saveProviderSelection(nextSelection);
          checkbox.disabled = true;

          try {
            const restartResult = await ipcRenderer.invoke('app:restart-elevated', {
              enableLaunchAsAdministrator: true,
              installHardwareAccessDriver: true
            });
            if (!restartResult || restartResult.ok !== true) {
              nextSelection.enhanced = false;
              saveProviderSelection(nextSelection);
              checkbox.checked = false;
              checkbox.disabled = false;
              alert(restartResult?.error || 'The administrator restart was cancelled. Enhanced Hardware Sensors remains disabled.');
            }
          } catch (error) {
            nextSelection.enhanced = false;
            saveProviderSelection(nextSelection);
            checkbox.checked = false;
            checkbox.disabled = false;
            alert(`Unable to restart with administrator privileges: ${error.message}`);
          }
          return;
        }

        nextSelection[providerKey] = !!checkbox.checked;
        saveProviderSelection(nextSelection);
        if (providerKey === 'enhanced') refreshHardwareAccessDriverUi();
        updateStats();
      });
    });
    refreshHardwareAccessDriverUi();

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
      applySummaryMode(savedSummaryMode, { animate: false });

      summaryButton.addEventListener('click', () => {
        applySummaryMode(!summaryModeEnabled);
      });
    }
    const resetSummaryStatsButton = document.getElementById('resetSummaryStatsBtn');
    if (resetSummaryStatsButton) {
      resetSummaryStatsButton.addEventListener('click', resetSensorSessionStatistics);
    }

    const debugButton = document.getElementById('debugModeBtn');
    if (debugButton) {
      const storedDebugMode = localStorage.getItem(DEBUG_MODE_KEY);
      const savedDebugMode = storedDebugMode === null ? false : storedDebugMode === 'true';
      applyDebugMode(savedDebugMode);

      debugButton.addEventListener('click', () => {
        if (!debugModeEnabled && summaryModeEnabled) {
          applySummaryMode(false);
        }
        applyDebugMode(!debugModeEnabled);
      });
    }

    const savedViewMode = normalizeViewMode(localStorage.getItem(VIEW_MODE_KEY) || 'standard');
    applyViewMode(savedViewMode, { persist: false });

    // Low Overhead Mode UI removed; no bindings required here.

    const webEnabled = document.getElementById('webMonitorEnabled');
    const webAutoStart = document.getElementById('webMonitorAutoStart');
    const webHost = document.getElementById('webMonitorHost');
    const webPort = document.getElementById('webMonitorPort');
    const webRequireAuth = document.getElementById('webMonitorRequireAuth');
    const webAuthToken = document.getElementById('webMonitorAuthToken');
    const webReadOnlyApiMode = document.getElementById('webMonitorReadOnlyApiMode');
    const webGenerateTokenBtn = document.getElementById('webMonitorGenerateTokenBtn');
    const webCopyTokenBtn = document.getElementById('webMonitorCopyTokenBtn');
    const webRiskWarning = document.getElementById('webMonitorRiskWarning');
    const webApplyBtn = document.getElementById('webMonitorApplyBtn');
    const webOpenBtn = document.getElementById('webMonitorOpenBtn');

    const refreshWebMonitorRiskWarning = () => {
      if (!webRiskWarning) return;
      const nextSettings = normalizeWebMonitorSettings({
        enabled: !!(webEnabled && webEnabled.checked),
        autoStart: !!(webAutoStart && webAutoStart.checked),
        host: webHost ? webHost.value : DEFAULT_WEB_MONITOR_SETTINGS.host,
        port: webPort ? Number(webPort.value) : DEFAULT_WEB_MONITOR_SETTINGS.port,
        requireAuth: !!(webRequireAuth && webRequireAuth.checked),
        authToken: webAuthToken ? webAuthToken.value : '',
        readOnlyApiMode: !!(webReadOnlyApiMode && webReadOnlyApiMode.checked)
      });
      if (nextSettings.requireAuth && !nextSettings.authToken) {
        nextSettings.authToken = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      }

      const isWideBind = nextSettings.host === '0.0.0.0' || nextSettings.host === '::';
      if (!nextSettings.enabled || !isWideBind) {
        webRiskWarning.style.display = 'none';
        webRiskWarning.textContent = '';
        return;
      }

      if (nextSettings.requireAuth && nextSettings.authToken) {
        webRiskWarning.textContent = 'Warning: server is exposed on all interfaces. Access token is enabled.';
      } else {
        webRiskWarning.textContent = 'High risk: server is exposed on all interfaces without token protection.';
      }
      webRiskWarning.style.display = 'block';
    };

    const applyWebSettings = async () => {
      const nextSettings = normalizeWebMonitorSettings({
        enabled: !!(webEnabled && webEnabled.checked),
        autoStart: !!(webAutoStart && webAutoStart.checked),
        host: webHost ? webHost.value : DEFAULT_WEB_MONITOR_SETTINGS.host,
        port: webPort ? Number(webPort.value) : DEFAULT_WEB_MONITOR_SETTINGS.port,
        requireAuth: !!(webRequireAuth && webRequireAuth.checked),
        authToken: webAuthToken ? webAuthToken.value : '',
        readOnlyApiMode: !!(webReadOnlyApiMode && webReadOnlyApiMode.checked)
      });

      if (webHost) webHost.value = nextSettings.host;
      if (webPort) webPort.value = String(nextSettings.port);
      if (webRequireAuth) webRequireAuth.checked = nextSettings.requireAuth;
      if (webAuthToken) webAuthToken.value = nextSettings.authToken;
      if (webReadOnlyApiMode) webReadOnlyApiMode.checked = nextSettings.readOnlyApiMode;

      saveWebMonitorSettings(nextSettings);
      refreshWebMonitorRiskWarning();
      await queueWebMonitorRuntimeState(nextSettings);
    };

    if (webApplyBtn) {
      webApplyBtn.addEventListener('click', () => {
        applyWebSettings();
      });
    }

    if (webOpenBtn) {
      webOpenBtn.addEventListener('click', () => {
        openWebMonitorInBrowser();
      });
    }

    if (webGenerateTokenBtn) {
      webGenerateTokenBtn.addEventListener('click', () => {
        const token = generateWebMonitorToken();
        if (webAuthToken) webAuthToken.value = token;
        if (webRequireAuth) webRequireAuth.checked = true;
        refreshWebMonitorRiskWarning();
      });
    }

    if (webCopyTokenBtn) {
      webCopyTokenBtn.addEventListener('click', async () => {
        const token = String(webAuthToken ? webAuthToken.value : '').trim();
        if (!token) {
          alert('No token to copy. Generate or enter a token first.');
          return;
        }
        try {
          if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(token);
          } else {
            throw new Error('Clipboard API unavailable');
          }
          alert('Access token copied to clipboard.');
        } catch (clipboardError) {
          try {
            const temp = document.createElement('textarea');
            temp.value = token;
            temp.setAttribute('readonly', 'readonly');
            temp.style.position = 'fixed';
            temp.style.opacity = '0';
            document.body.appendChild(temp);
            temp.select();
            document.execCommand('copy');
            temp.remove();
            alert('Access token copied to clipboard.');
          } catch (fallbackError) {
            alert('Failed to copy token. Please copy it manually.');
          }
        }
      });
    }

    // Web Monitor toggle button in header
    const webMonitorToggleBtn = document.getElementById('webMonitorToggleBtn');
    if (webMonitorToggleBtn) {
      webMonitorToggleBtn.addEventListener('click', (event) => {
        const openIcon = event.target && event.target.closest ? event.target.closest('.web-monitor-open-icon') : null;
        if (openIcon) {
          event.preventDefault();
          event.stopPropagation();
          openWebMonitorInBrowser();
          return;
        }
        const webEnabledCheckbox = document.getElementById('webMonitorEnabled');
        const nextEnabled = !webMonitorDesiredEnabled;
        if (webEnabledCheckbox) {
          // The header controls the requested service state, not a possibly
          // stale checkbox value left by auto-start or a failed bind attempt.
          webEnabledCheckbox.checked = nextEnabled;
        }
        applyWebSettings();
      });
    }

    const savedWebSettings = normalizeWebMonitorSettings(loadWebMonitorSettings());
    if (webEnabled) webEnabled.checked = savedWebSettings.enabled;
    if (webAutoStart) webAutoStart.checked = savedWebSettings.autoStart;
    if (webHost) webHost.value = savedWebSettings.host;
    if (webPort) webPort.value = String(savedWebSettings.port);
    if (webRequireAuth) webRequireAuth.checked = savedWebSettings.requireAuth;
    if (webAuthToken) webAuthToken.value = savedWebSettings.authToken;
    if (webReadOnlyApiMode) webReadOnlyApiMode.checked = savedWebSettings.readOnlyApiMode;
    if (webEnabled) {
      webEnabled.addEventListener('change', () => {
        applyWebSettings();
      });
    }
    [webHost, webPort, webRequireAuth, webAuthToken, webReadOnlyApiMode].forEach((el) => {
      if (!el) return;
      const eventName = el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'number') ? 'input' : 'change';
      el.addEventListener(eventName, refreshWebMonitorRiskWarning);
    });
    refreshWebMonitorRiskWarning();
    refreshWebMonitorStatusUi();

    webMonitorDesiredEnabled = false;
    if (savedWebSettings.enabled && savedWebSettings.autoStart) {
      queueWebMonitorRuntimeState(savedWebSettings);
    }

    const appBehaviorControls = {
      launchAtStartup: document.getElementById('launchAtStartup'),
      launchAsAdministrator: document.getElementById('launchAsAdministrator'),
      startMinimized: document.getElementById('startMinimized'),
      minimizeToTray: document.getElementById('minimizeToTray'),
      closeToTray: document.getElementById('closeToTray'),
      autoCheckForUpdates: document.getElementById('autoCheckForUpdates'),
      startupDelaySeconds: document.getElementById('startupDelaySeconds')
    };

    const discordPresenceSelect = document.getElementById('discordPresenceSelect');
    const discordPresenceStatus = document.getElementById('discordPresenceStatus');

    const applyAppBehaviorToUi = (settings) => {
      const normalized = normalizeAppBehaviorSettings(settings);
      Object.entries(appBehaviorControls).forEach(([key, element]) => {
        if (!element) return;
        if (element.type === 'checkbox') {
          element.checked = !!normalized[key];
        } else {
          element.value = String(normalized[key] ?? '');
        }
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
        toggleBtn.classList.remove('disabled', 'enabled', 'connected');
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
        launchAsAdministrator: !!appBehaviorControls.launchAsAdministrator?.checked,
        startMinimized: !!appBehaviorControls.startMinimized?.checked,
        minimizeToTray: !!appBehaviorControls.minimizeToTray?.checked,
        closeToTray: !!appBehaviorControls.closeToTray?.checked,
        autoCheckForUpdates: !!appBehaviorControls.autoCheckForUpdates?.checked,
        startupDelaySeconds: appBehaviorControls.startupDelaySeconds?.value,
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

    ipcRenderer.on('overlay:toggle-state-changed', (_event, enabled) => {
      const overlayEnabledToggle = document.getElementById('overlayEnabledToggle');
      if (overlayEnabledToggle) {
        overlayEnabledToggle.checked = enabled;
        saveOverlaySetting(OVERLAY_ENABLED_KEY, enabled ? 'true' : 'false');
        updateOverlayToggleButton(enabled);
      }
    });

    ipcRenderer.on('overlay:position-changed', (_event, payload) => {
      const x = normalizeOverlayCoordinate(payload && payload.x);
      const y = normalizeOverlayCoordinate(payload && payload.y);
      if (x === null || y === null) return;
      saveOverlaySetting(OVERLAY_CUSTOM_X_KEY, String(x));
      saveOverlaySetting(OVERLAY_CUSTOM_Y_KEY, String(y));
      saveOverlaySetting(OVERLAY_CUSTOM_POSITION_ENABLED_KEY, 'true');
    });

    ipcRenderer.on('overlay:hotkey-toggle-request', () => {
      const overlayEnabledToggle = document.getElementById('overlayEnabledToggle');
      const currentEnabled = localStorage.getItem(OVERLAY_ENABLED_KEY) === 'true';
      const newEnabled = !currentEnabled;
      saveOverlaySetting(OVERLAY_ENABLED_KEY, newEnabled ? 'true' : 'false');
      if (overlayEnabledToggle) overlayEnabledToggle.checked = newEnabled;
      updateOverlayToggleButton(newEnabled);
      refreshOverlayWindowState(newEnabled);
    });

    getAppBehaviorSettings().then(async (settings) => {
      let effectiveSettings = settings;

      // Versions prior to this migration could leave Enhanced Hardware Sensors
      // enabled without remembering to elevate future launches. Repair that
      // state once, then restart now so this launch also gets prompt readings.
      if (providerSelection.enhanced === true && settings.launchAsAdministrator !== true) {
        const runningElevated = await ipcRenderer.invoke('app:is-elevated').catch(() => false);
        if (runningElevated) {
          effectiveSettings = await setAppBehaviorSettings({
            ...settings,
            launchAsAdministrator: true
          });
        } else {
          const restartResult = await ipcRenderer.invoke('app:restart-elevated', {
            enableLaunchAsAdministrator: true
          }).catch((error) => ({ ok: false, error: error.message }));
          if (restartResult && restartResult.ok === true) return;
          effectiveSettings = restartResult?.settings || settings;
        }
      }

      applyAppBehaviorToUi(effectiveSettings);
      updateDiscordPresenceStatusUi({ enabled: effectiveSettings.enableDiscordRichPresence, connected: effectiveSettings.enableDiscordRichPresence ? null : false });
      if (effectiveSettings.autoCheckForUpdates) {
        setTimeout(() => {
          performUpdateCheck({ automatic: true }).catch(() => {});
        }, 900);
      }
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
      setModalShellVisible(updateAvailableModal, visible);
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

    const performUpdateCheck = async ({ automatic = false } = {}) => {
        if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') {
          setUpdateStatus('Update check is unavailable in this runtime.');
          return;
        }

        if (checkForUpdatesBtn) checkForUpdatesBtn.disabled = true;
        latestReleaseUrl = DEFAULT_LATEST_RELEASE_URL;
        toggleOpenLatestButton(/^https?:\/\//i.test(latestReleaseUrl));
        setUpdateStatus(automatic ? 'Auto-checking for updates...' : 'Checking for updates...');

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
          if (checkForUpdatesBtn) checkForUpdatesBtn.disabled = false;
        }
    };

    if (checkForUpdatesBtn) {
      checkForUpdatesBtn.addEventListener('click', async () => {
        await performUpdateCheck({ automatic: false });
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
    overlaySensorSelection = loadOverlaySensorSelection();
    sensorCategorySelection = loadSensorCategorySelection();
    sensorCategoryCollapse = loadSensorCategoryCollapse();
    sensorOrderByGroup = loadSensorOrder();
    sensorAlertRules = loadSensorAlertRules();
    restorePersistedSensorCatalogForStartup();
    const alertSensorSelect = document.getElementById('alertSensorSelect');
    const alertRuleEnabled = document.getElementById('alertRuleEnabled');
    const alertOperatorSelect = document.getElementById('alertOperatorSelect');
    const alertThresholdInput = document.getElementById('alertThresholdInput');
    const alertCooldownInput = document.getElementById('alertCooldownInput');
    const alertSeveritySelect = document.getElementById('alertSeveritySelect');
    const saveAlertRuleBtn = document.getElementById('saveAlertRuleBtn');
    const deleteAlertRuleBtn = document.getElementById('deleteAlertRuleBtn');

    if (saveAlertRuleBtn) {
      saveAlertRuleBtn.addEventListener('click', () => {
        const sensorId = String(alertSensorSelect ? alertSensorSelect.value : '').trim();
        if (!sensorId) {
          alert('Select a sensor first.');
          return;
        }
        const threshold = Number(alertThresholdInput ? alertThresholdInput.value : NaN);
        if (!Number.isFinite(threshold)) {
          alert('Enter a valid threshold.');
          return;
        }
        const nextRule = normalizeSensorAlertRule({
          enabled: !!(alertRuleEnabled && alertRuleEnabled.checked),
          operator: alertOperatorSelect ? alertOperatorSelect.value : '>=',
          threshold,
          cooldownSec: alertCooldownInput ? alertCooldownInput.value : 30,
          severity: alertSeveritySelect ? alertSeveritySelect.value : 'warning'
        });
        sensorAlertRules[sensorId] = nextRule;
        saveSensorAlertRules();
        refreshSensorAlertEditor(cachedOrderedSensorCatalog || createEmptyGroupedBuckets());
      });
    }

    if (deleteAlertRuleBtn) {
      deleteAlertRuleBtn.addEventListener('click', () => {
        const sensorId = String(alertSensorSelect ? alertSensorSelect.value : '').trim();
        if (!sensorId) {
          alert('Select a sensor first.');
          return;
        }
        if (sensorAlertRules[sensorId]) {
          delete sensorAlertRules[sensorId];
          saveSensorAlertRules();
          delete activeSensorAlertState[sensorId];
          delete sensorAlertLastTriggeredAt[sensorId];
        }
        refreshSensorAlertEditor(cachedOrderedSensorCatalog || createEmptyGroupedBuckets());
      });
    }

    const sensorOptions = document.getElementById('sensorOptions');
    const sensorSearchInput = document.getElementById('sensorSearchInput');
    const sensorHideUntickedBtn = document.getElementById('sensorHideUntickedBtn');
    if (sensorSearchInput) {
      sensorSearchInput.addEventListener('input', applySensorSelectionFilter);
      sensorSearchInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !sensorSearchInput.value) return;
        event.preventDefault();
        sensorSearchInput.value = '';
        applySensorSelectionFilter();
      });
    }
    if (sensorHideUntickedBtn) {
      syncSensorHideUntickedButton();
      sensorHideUntickedBtn.addEventListener('click', () => {
        const enabled = !sensorHideUntickedEnabled();
        localStorage.setItem(SENSOR_HIDE_UNTICKED_KEY, enabled ? 'true' : 'false');
        syncSensorHideUntickedButton();
        applySensorSelectionFilter();
      });
    }

    if (sensorOptions) {
      const sensorDragState = {
        group: '',
        sensorId: '',
        overSensorId: '',
        placeAfter: false,
        scrollContainer: null,
        lastClientX: 0,
        lastClientY: 0,
        scrollVelocity: 0,
        animationFrame: 0
      };

      const clearSensorDragClasses = () => {
        sensorOptions.querySelectorAll('.sensor-item-row.dragging, .sensor-item-row.drag-over-before, .sensor-item-row.drag-over-after').forEach((row) => {
          row.classList.remove('dragging', 'drag-over-before', 'drag-over-after');
        });
      };

      const sensorRowIsVisible = (row) => !!row &&
        !row.classList.contains('is-search-hidden') &&
        row.getClientRects().length > 0;

      const getSensorRowsForGroup = (group) => Array.from(sensorOptions.querySelectorAll('.sensor-item-row[data-order-group][data-order-sensor-id]'))
        .filter((row) => row.dataset.orderGroup === group && sensorRowIsVisible(row));

      const getDraggedSensorRow = () => getSensorRowsForGroup(sensorDragState.group)
        .find((row) => row.dataset.orderSensorId === sensorDragState.sensorId) || null;

      const resolveSensorDragScrollContainer = () => {
        const sidebar = sensorOptions.closest('.sidebar');
        if (sidebar) return sidebar;

        let candidate = sensorOptions.parentElement;
        while (candidate) {
          const overflowY = window.getComputedStyle(candidate).overflowY;
          if (/(auto|scroll)/i.test(overflowY) && candidate.scrollHeight > candidate.clientHeight) return candidate;
          candidate = candidate.parentElement;
        }
        return null;
      };

      const updateSensorDropIndicator = (clientY, preferredRow = null) => {
        if (!sensorDragState.sensorId || !sensorDragState.group) return;

        const rows = getSensorRowsForGroup(sensorDragState.group);
        let targetRow = preferredRow;
        if (!targetRow ||
            targetRow.dataset.orderGroup !== sensorDragState.group ||
            targetRow.dataset.orderSensorId === sensorDragState.sensorId ||
            !sensorRowIsVisible(targetRow)) {
          targetRow = rows
            .filter((row) => row.dataset.orderSensorId !== sensorDragState.sensorId)
            .map((row) => {
              const rect = row.getBoundingClientRect();
              return { row, distance: Math.abs(clientY - (rect.top + (rect.height / 2))) };
            })
            .sort((a, b) => a.distance - b.distance)[0]?.row || null;
        }

        clearSensorDragClasses();
        getDraggedSensorRow()?.classList.add('dragging');

        if (!targetRow) {
          sensorDragState.overSensorId = '';
          return;
        }

        const targetRect = targetRow.getBoundingClientRect();
        sensorDragState.placeAfter = (clientY - targetRect.top) > (targetRect.height / 2);
        sensorDragState.overSensorId = targetRow.dataset.orderSensorId || '';
        targetRow.classList.add(sensorDragState.placeAfter ? 'drag-over-after' : 'drag-over-before');
      };

      const updateSensorDragScrollVelocity = () => {
        const scrollContainer = sensorDragState.scrollContainer;
        if (!scrollContainer || !sensorDragState.sensorId) {
          sensorDragState.scrollVelocity = 0;
          return;
        }

        const rect = scrollContainer.getBoundingClientRect();
        const edgeSize = Math.min(84, Math.max(48, rect.height * 0.13));
        const xInside = sensorDragState.lastClientX >= rect.left && sensorDragState.lastClientX <= rect.right;
        const y = sensorDragState.lastClientY;
        let velocity = 0;

        if (xInside && y <= rect.top + edgeSize && y >= rect.top - 24 && scrollContainer.scrollTop > 0) {
          const strength = Math.min(1, Math.max(0, (rect.top + edgeSize - y) / edgeSize));
          velocity = -(4 + (strength * 20));
        } else if (xInside && y >= rect.bottom - edgeSize && y <= rect.bottom + 24 &&
                   scrollContainer.scrollTop < scrollContainer.scrollHeight - scrollContainer.clientHeight) {
          const strength = Math.min(1, Math.max(0, (y - (rect.bottom - edgeSize)) / edgeSize));
          velocity = 4 + (strength * 20);
        }

        sensorDragState.scrollVelocity = velocity;
      };

      const runSensorDragAutoScroll = () => {
        if (!sensorDragState.sensorId) {
          sensorDragState.animationFrame = 0;
          return;
        }

        const scrollContainer = sensorDragState.scrollContainer;
        updateSensorDragScrollVelocity();
        if (scrollContainer && sensorDragState.scrollVelocity) {
          const previousScrollTop = scrollContainer.scrollTop;
          scrollContainer.scrollTop += sensorDragState.scrollVelocity;
          if (scrollContainer.scrollTop !== previousScrollTop) {
            updateSensorDropIndicator(sensorDragState.lastClientY);
          }
        }

        sensorDragState.animationFrame = window.requestAnimationFrame(runSensorDragAutoScroll);
      };

      const finishSensorDrag = () => {
        if (sensorDragState.animationFrame) {
          window.cancelAnimationFrame(sensorDragState.animationFrame);
        }
        sensorDragState.group = '';
        sensorDragState.sensorId = '';
        sensorDragState.overSensorId = '';
        sensorDragState.placeAfter = false;
        sensorDragState.scrollContainer = null;
        sensorDragState.scrollVelocity = 0;
        sensorDragState.animationFrame = 0;
        document.body.classList.remove('sensor-order-dragging');
        clearSensorDragClasses();
      };

      const handleSensorDragPointer = (event) => {
        if (!sensorDragState.sensorId || !sensorDragState.scrollContainer) return;
        if (event.clientX === 0 && event.clientY === 0) return;

        const scrollRect = sensorDragState.scrollContainer.getBoundingClientRect();
        const withinHorizontalBounds = event.clientX >= scrollRect.left && event.clientX <= scrollRect.right;
        if (!withinHorizontalBounds) {
          sensorDragState.scrollVelocity = 0;
          return;
        }

        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        sensorDragState.lastClientX = event.clientX;
        sensorDragState.lastClientY = event.clientY;

        const eventTarget = event.target instanceof Element ? event.target : null;
        const preferredRow = eventTarget?.closest('.sensor-item-row[data-order-group][data-order-sensor-id]') || null;
        updateSensorDropIndicator(event.clientY, preferredRow);
        updateSensorDragScrollVelocity();
      };

      document.addEventListener('dragover', handleSensorDragPointer, true);
      document.addEventListener('wheel', (event) => {
        const scrollContainer = sensorDragState.scrollContainer;
        if (!sensorDragState.sensorId || !scrollContainer) return;

        let delta = Number(event.deltaY || event.deltaX || 0);
        if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 18;
        if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= scrollContainer.clientHeight;
        if (!delta) return;

        event.preventDefault();
        event.stopPropagation();
        scrollContainer.scrollTop += delta;
        updateSensorDropIndicator(sensorDragState.lastClientY);
        updateSensorDragScrollVelocity();
      }, { capture: true, passive: false });

      document.addEventListener('keydown', (event) => {
        const scrollContainer = sensorDragState.scrollContainer;
        if (!sensorDragState.sensorId || !scrollContainer) return;
        const stepByKey = {
          ArrowUp: -48,
          ArrowDown: 48,
          PageUp: -Math.max(120, scrollContainer.clientHeight * 0.75),
          PageDown: Math.max(120, scrollContainer.clientHeight * 0.75)
        };
        if (!Object.prototype.hasOwnProperty.call(stepByKey, event.key)) return;
        event.preventDefault();
        scrollContainer.scrollTop += stepByKey[event.key];
        updateSensorDropIndicator(sensorDragState.lastClientY);
      }, true);

      sensorOptions.addEventListener('click', (e) => {
        const resetNameButton = e.target.closest('[data-reset-sensor-name-id]');
        if (resetNameButton) {
          e.preventDefault();
          e.stopPropagation();
          if (resetNameButton.disabled) return;
          resetCustomSensorName(resetNameButton.dataset.resetSensorNameId);
          return;
        }

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

        const searchQuery = normalizeSensorSearchText(document.getElementById('sensorSearchInput')?.value);
        if (searchQuery) {
          const nextSearchCollapsed = !block.classList.contains('is-search-collapsed');
          if (nextSearchCollapsed) sensorSearchCollapsedGroups.add(group);
          else sensorSearchCollapsedGroups.delete(group);
          applySensorSelectionFilter();
          return;
        }

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
          refreshSensorAlertEditor(cachedOrderedSensorCatalog || createEmptyGroupedBuckets());
          sensorCatalogSignature = '';
          liveSensorCatalogSignature = '';
          updateStats();
          return;
        }
        if (target && target.dataset && target.dataset.sensorId) {
          sensorSelection[target.dataset.sensorId] = !!target.checked;
          saveSensorSelection();
          refreshSensorAlertEditor(cachedOrderedSensorCatalog || createEmptyGroupedBuckets());
          applySensorSelectionFilter();
          updateStats();
          return;
        }
        if (target && target.dataset && target.dataset.overlaySensorId) {
          overlaySensorSelection[target.dataset.overlaySensorId] = !!target.checked;
          saveOverlaySensorSelection();
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
        sensorDragState.scrollContainer = resolveSensorDragScrollContainer();
        sensorDragState.lastClientX = e.clientX;
        sensorDragState.lastClientY = e.clientY;

        if (!sensorDragState.group || !sensorDragState.sensorId) {
          e.preventDefault();
          return;
        }

        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', `${sensorDragState.group}:${sensorDragState.sensorId}`);
        }

        setTimeout(() => {
          if (sensorDragState.sensorId) row.classList.add('dragging');
        }, 0);

        document.body.classList.add('sensor-order-dragging');
        if (!sensorDragState.animationFrame) {
          sensorDragState.animationFrame = window.requestAnimationFrame(runSensorDragAutoScroll);
        }
      });

      sensorOptions.addEventListener('drop', (e) => {
        if (!sensorDragState.sensorId || !sensorDragState.group) return;

        e.preventDefault();
        if (!sensorDragState.overSensorId || sensorDragState.overSensorId === sensorDragState.sensorId) {
          finishSensorDrag();
          return;
        }

        const group = sensorDragState.group;
        const sensorId = sensorDragState.sensorId;
        const targetSensorId = sensorDragState.overSensorId;
        const placeAfter = sensorDragState.placeAfter;
        const visibleSensorIds = getSensorRowsForGroup(group).map((row) => row.dataset.orderSensorId).filter(Boolean);
        finishSensorDrag();
        moveSensorOrderByDrop(group, sensorId, targetSensorId, placeAfter, visibleSensorIds);
      });

      sensorOptions.addEventListener('dragend', finishSensorDrag);
    }

    // Restore saved settings
    const savedTheme = ThemeManager.getTheme();
    const savedRefreshRate = localStorage.getItem('refreshRate');

    ThemeManager.setTheme(savedTheme, { persist: false, updatePalettes: false });
    DisplayModeManager.apply(getDisplayModePreference(), { persist: false });

    if (savedRefreshRate) {
      updateInterval = clampRefreshInterval(savedRefreshRate);
      refreshSlider.value = String(updateInterval);
      refreshValue.textContent = String(updateInterval);
      localStorage.setItem('refreshRate', String(updateInterval));
    }

    applyOverlaySettings();
    initializeSetupGuideModal();
    initializeDiagnosticsModal();
    initializeImportSettingsModal();
  }
};

async function updateStats(forceRender = false) {
  const providerSelection = loadProviderSelection();
  const updateCycleStartedAt = performance.now();

  if (updateInProgress) {
    rerunUpdateRequested = true;
    return;
  }
  updateInProgress = true;

  try {
    // Latency probing can take up to a few seconds on an unreachable host.
    // Keep it off the critical path so core hardware sensors render immediately.
    sampleLatencyIfNeeded().catch(() => {});

    const rawMode = localStorage.getItem('detectionMode') || 'builtin';
    const mode = 'builtin';
    if (rawMode !== mode) {
      localStorage.setItem('detectionMode', mode);
    }

    const isDocumentHidden = typeof document !== 'undefined' && !!document.hidden;
    const shouldUpdateDesktopUi = !isDocumentHidden;

    const aidaPath = localStorage.getItem('aidaPath') || '';
    const appRuntimeStatsPromise = getAppRuntimeStats();
    const sensorReadStartedAt = performance.now();
    const data = await sensorReader.getEnhancedData(mode, { aidaPath, providers: providerSelection });
    lastSensorReadDurationMs = Math.max(0, performance.now() - sensorReadStartedAt);
    const appRuntimeStats = await appRuntimeStatsPromise;
    const builtinStatus = shouldUpdateDesktopUi ? document.getElementById('builtinSensorStatus') : null;
    if (builtinStatus) {
      const diagnostics = data && data.external && data.external.diagnostics;
      if (providerSelection.builtin === false) {
        builtinStatus.textContent = 'Built-in collector is disabled.';
      } else if (!diagnostics) {
        builtinStatus.textContent = 'Built-in collector is unavailable. Run the sensor-host build or restart SiR.';
      } else {
        const standardCount = Number(diagnostics.standardSensorCount) || 0;
        const enhancedCount = Number(diagnostics.enhancedSensorCount) || 0;
        if (providerSelection.enhanced === true && diagnostics.enhancedInitializing === true) {
          builtinStatus.textContent = `Built-in collector active: ${standardCount} standard + ${enhancedCount} enhanced sensors; more hardware is still being detected.`;
        } else if (providerSelection.enhanced === true && diagnostics.enhancedAvailable === true) {
          builtinStatus.textContent = `Built-in collector active: ${standardCount} standard + ${enhancedCount} enhanced sensors.`;
        } else if (providerSelection.enhanced === true) {
          const warning = String(diagnostics.warning || '').trim();
          builtinStatus.textContent = warning
            ? `Standard sensors active; enhanced access unavailable (${warning}).`
            : 'Standard sensors active; enhanced access is unavailable on this system.';
        } else {
          builtinStatus.textContent = `Built-in collector active: ${standardCount} standard sensors.`;
        }

        const hardwareAccessStatus = document.getElementById('hardwareAccessDriverStatus');
        if (hardwareAccessStatus && providerSelection.enhanced === true && diagnostics.intelCpuDetected === true && diagnostics.enhancedInitializing !== true) {
          const unavailablePowerDomains = Array.isArray(diagnostics.unavailableCpuPowerDomains)
            ? diagnostics.unavailableCpuPowerDomains.map((name) => String(name || '').trim()).filter(Boolean)
            : [];
          const unavailableDetail = unavailablePowerDomains.length
            ? ` Domains not reporting energy data are hidden: ${unavailablePowerDomains.join(', ')}.`
            : '';
          if (diagnostics.cpuPackagePowerAvailable === true) {
            hardwareAccessStatus.textContent = `Low-level hardware access driver: Ready${diagnostics.hardwareAccessDriverVersion ? ` (PawnIO ${diagnostics.hardwareAccessDriverVersion})` : ''}; Intel CPU package power is active.${unavailableDetail}`;
            hardwareAccessStatus.classList.remove('web-status-error');
          } else if (diagnostics.hardwareAccessDriverInstalled === true) {
            hardwareAccessStatus.textContent = `Low-level hardware access driver: Ready${diagnostics.hardwareAccessDriverVersion ? ` (PawnIO ${diagnostics.hardwareAccessDriverVersion})` : ''}, but this Intel CPU did not report package power.${unavailableDetail}`;
            hardwareAccessStatus.classList.add('web-status-error');
          }
        }
      }
    }

    const nativeFpsStatus = shouldUpdateDesktopUi ? document.getElementById('nativeFpsStatus') : null;
    if (nativeFpsStatus) {
      const diagnostics = data && data.external && data.external.diagnostics;
      nativeFpsStatus.classList.remove('web-status-error');
      const gpuVendor = String(diagnostics && diagnostics.nativeFpsGpuVendor || '').trim();
      const captureMethod = String(diagnostics && diagnostics.nativeFpsCaptureMethod || '').trim();
      const methodDetail = gpuVendor || captureMethod
        ? ` (${[gpuVendor, captureMethod].filter(Boolean).join(', ')})`
        : '';
      const recoveredSessions = Math.max(0, Number(diagnostics && diagnostics.nativeFpsRecoveredTraceSessions) || 0);
      const recoveryDetail = recoveredSessions > 0
        ? ` Recovered ${recoveredSessions} abandoned capture session${recoveredSessions === 1 ? '' : 's'}.`
        : '';
      if (providerSelection.builtin === false) {
        nativeFpsStatus.textContent = 'Native FPS collector is disabled with Built-in Sensors.';
      } else if (!diagnostics || diagnostics.nativeFpsAvailable !== true) {
        nativeFpsStatus.textContent = 'Native FPS collector is unavailable. Reinstall SiR System Monitor to restore the bundled component.';
        nativeFpsStatus.classList.add('web-status-error');
      } else if (String(diagnostics.nativeFpsError || '').trim()) {
        nativeFpsStatus.textContent = `Native FPS collector error${methodDetail}: ${String(diagnostics.nativeFpsError).trim()}${recoveryDetail}`;
        nativeFpsStatus.classList.add('web-status-error');
      } else if (String(diagnostics.nativeFpsApplication || '').trim()) {
        nativeFpsStatus.textContent = `Native FPS active${methodDetail}: ${String(diagnostics.nativeFpsApplication).trim()} (PID ${Number(diagnostics.nativeFpsProcessId) || 0}).${recoveryDetail}`;
      } else if (diagnostics.nativeFpsRunning === true) {
        nativeFpsStatus.textContent = String(diagnostics.nativeFpsWarning || '').trim()
          ? `Native FPS ready${methodDetail}; focus a running game to begin reading frames. Administrator mode improves process detection.${recoveryDetail}`
          : `Native FPS ready${methodDetail}; focus a running game to begin reading frames.${recoveryDetail}`;
      } else {
        nativeFpsStatus.textContent = `Native FPS collector is starting${methodDetail}...${recoveryDetail}`;
      }
    }

    // update external group title
    const titleEl = shouldUpdateDesktopUi ? document.querySelector('#externalGroup .sensor-group-title') : null;
    if (titleEl) {
      titleEl.innerHTML = '<i class="bi bi-tools group-icon" aria-hidden="true"></i><span>Other</span>';
    }

    if (!data) {
      lastDebugExternalData = null;
      if (debugModeEnabled && shouldUpdateDesktopUi) {
        renderDebugPanel(null, mode);
      }
      const now = Date.now();
      if ((now - lastSuccessfulSensorReadAt) > SENSOR_READ_STALE_HOLD_MS) {
        latestSelectedGroupedSensors = createEmptyGroupedBuckets();
      }
      mergeAppTelemetryIntoCurrentSelection(appRuntimeStats);
      prepareSelectedSensorsForRender(latestSelectedGroupedSensors);
      renderAllDynamicGroups(latestSelectedGroupedSensors);
      evaluateSensorAlerts(latestSelectedGroupedSensors);
      sendOverlayPayload(getOverlaySensorPayload(latestSelectedGroupedSensors));
      if (webMonitorRuntime.running) {
        publishWebMonitorPayload(mode, 'No data');
      }
      return;
    }

    // External sensor data (MSI Afterburner/RTSS)
    if (data.external && typeof data.external === 'object') {
      lastDebugExternalData = data.external;
      if (debugModeEnabled && shouldUpdateDesktopUi) {
        renderDebugPanel(data.external, mode);
      }
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

      if (data.external.groupedSensors) {
        const groupedWithRealtime = attachAppTelemetrySensors(enrichGroupedSensorsWithRealtime(data.external.groupedSensors, {
          ...data.external,
          fps: Number.isFinite(externalFps) ? externalFps : data.external.fps,
          frameTime: Number.isFinite(normalizedFrameTime) ? normalizedFrameTime : data.external.frameTime
        }), appRuntimeStats);
        const enhancedStillInitializing = providerSelection.enhanced === true &&
          data.external.diagnostics?.enhancedInitializing === true;

        const nextCatalogSignature = buildLiveSensorCatalogSignature(groupedWithRealtime);
        const catalogDiscoveryModeChanged = cachedCatalogPreservingMissingSensors !== enhancedStillInitializing;
        if (!liveSensorCatalogSignature || liveSensorCatalogSignature !== nextCatalogSignature || catalogDiscoveryModeChanged) {
          rebuildCachedSensorCatalog(groupedWithRealtime, {
            preserveMissing: enhancedStillInitializing,
            persist: providerSelection.enhanced === true && !enhancedStillInitializing
          });
          liveSensorCatalogSignature = nextCatalogSignature;
          cachedCatalogPreservingMissingSensors = enhancedStillInitializing;
        }

        const selected = buildSelectedSensorsFromCachedCatalog(groupedWithRealtime, {
          preserveMissing: enhancedStillInitializing
        });
        prepareSelectedSensorsForRender(selected);
        latestSelectedGroupedSensors = selected;
        updateSensorHistory(selected);
        if (shouldCollectSummaryStats()) {
          updateSensorSessionStats(selected);
        }
        evaluateSensorAlerts(selected);
        lastSuccessfulSensorReadAt = Date.now();
        renderAllDynamicGroups(selected, { force: forceRender });
        sendOverlayPayload(getOverlaySensorPayload(selected));
      } else {
        const now = Date.now();
        if ((now - lastSuccessfulSensorReadAt) > SENSOR_READ_STALE_HOLD_MS) {
          latestSelectedGroupedSensors = createEmptyGroupedBuckets();
        }
        mergeAppTelemetryIntoCurrentSelection(appRuntimeStats);
        prepareSelectedSensorsForRender(latestSelectedGroupedSensors);
        renderAllDynamicGroups(latestSelectedGroupedSensors, { force: forceRender });
        evaluateSensorAlerts(latestSelectedGroupedSensors);
      }

      const externalText = externalInfo.length > 0 ? externalInfo.join(' | ') : 'No data';
      if (webMonitorRuntime.running) {
        publishWebMonitorPayload(mode, externalText);
      }
    } else {
      lastDebugExternalData = null;
      if (debugModeEnabled && shouldUpdateDesktopUi) {
        renderDebugPanel(null, mode);
      }
      const now = Date.now();
      if ((now - lastSuccessfulSensorReadAt) > SENSOR_READ_STALE_HOLD_MS) {
        latestSelectedGroupedSensors = createEmptyGroupedBuckets();
      }
      mergeAppTelemetryIntoCurrentSelection(appRuntimeStats);
      prepareSelectedSensorsForRender(latestSelectedGroupedSensors);
      renderAllDynamicGroups(latestSelectedGroupedSensors, { force: forceRender });
      evaluateSensorAlerts(latestSelectedGroupedSensors);
      sendOverlayPayload(getOverlaySensorPayload(latestSelectedGroupedSensors));
      if (webMonitorRuntime.running) {
        publishWebMonitorPayload(mode, 'N/A');
      }
    }

  } catch (error) {
  } finally {
    lastUpdateCycleDurationMs = Math.max(0, performance.now() - updateCycleStartedAt);
    updateInProgress = false;
    if (rerunUpdateRequested) {
      rerunUpdateRequested = false;
      setTimeout(() => {
        updateStats(false);
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

    await updateStats(false);

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
  const requestId = ++updateClockRequestId;
  mainProcessUpdateClockActive = false;

  if (ipcRenderer && typeof ipcRenderer.invoke === 'function') {
    ipcRenderer.invoke('monitoring:set-refresh-interval', updateInterval).then((result) => {
      if (requestId !== updateClockRequestId || !updateLoopActive) return;
      if (result && result.ok === true) {
        mainProcessUpdateClockActive = true;
        clearTimeout(updateTimer);
        return;
      }
      scheduleNextUpdateTick();
    }).catch(() => {
      if (requestId !== updateClockRequestId || !updateLoopActive) return;
      scheduleNextUpdateTick();
    });
    return;
  }

  scheduleNextUpdateTick();
}

if (ipcRenderer && typeof ipcRenderer.on === 'function') {
  ipcRenderer.on('monitoring:tick', () => {
    if (!updateLoopActive || !mainProcessUpdateClockActive) return;
    updateStats(false);
  });
}

function applyUiTooltips() {
  const tooltips = {
    summaryModeBtn: 'Toggle Summary Mode with session minimum, average, and maximum values.',
    resetSummaryStatsBtn: 'Reset Summary Mode session minimum, average, and maximum values.',
    webMonitorToggleBtn: 'Toggle browser web monitor on/off.',
    discordPresenceToggleBtn: 'Toggle Discord Rich Presence integration.',
    overlayToggleBtn: 'Quickly toggle the on-screen overlay.',
    setupGuideHeaderBtn: 'Open setup and provider guidance.',
    monitoringModeBtn: 'Open or close the settings sidebar.',
    refreshRate: 'Set how often sensor data refreshes (milliseconds).',
    layoutPresetSelect: 'Choose the sensor-card layout used in normal mode.',
    summaryLayoutPresetSelect: 'Choose the independent sensor-card layout used in Summary Mode.',
    groupLineLimit: 'Legacy control (kept for compatibility if present).',
    latencyHost: 'Host/IP used for ping statistics.',
    overlayEnabledToggle: 'Enable the always-on-top overlay window.',
    overlayFontFamilySelect: 'Choose overlay font family.',
    overlayPositionSelect: 'Choose overlay corner placement.',
    overlayStyleSelect: 'Choose overlay rendering style.',
    overlayMonitorSelect: 'Choose which display shows the overlay.',
    overlayFontSizeSlider: 'Adjust overlay text size.',
    overlayGroupSpacing: 'Adjust spacing between overlay groups.',
    overlayScale: 'Scale sensor value/unit text size.',
    overlayOpacity: 'Adjust overlay background opacity.',
    overlayLineLimitsToggle: 'Show/hide per-category line-limit controls.',
    overlayHotkey: 'Set keyboard shortcut to toggle overlay.',
    overlayFontBoldToggle: 'Use bold overlay text.',
    overlayShowUnitsToggle: 'Show or hide units in overlay values.',
    overlayDragUnlockToggle: 'Allow dragging overlay while unlocked.',
    overlayTextColor: 'Overlay label text color.',
    overlayValueColor: 'Overlay value text color.',
    overlayBackgroundColor: 'Overlay background color.',
    temperatureUnitSelect: 'Choose temperature display unit.',
    customFontColor: 'Main UI font color.',
    customSensorNameColor: 'Sensor label color.',
    customSensorValueColor: 'Sensor value color.',
    customGraphColor: 'Graph line color.',
    customBlockHeaderColor: 'Sensor-group header color.',
    customIconColor: 'Sensor-group icon color.',
    customOutlineColor: 'Border/outline color.',
    customBackgroundColor: 'Background color.',
    customSettingsPanelColor: 'Independent background color for the settings panel.',
    customSettingsPanelAccentColor: 'Accent color used by settings controls, highlights, and active states.',
    customSettingsPanelIconColor: 'Icon color used throughout the settings panel.',
    animationEnabledToggle: 'Enable or disable all configurable interface motion.',
    animationSettingsToggle: 'Animate settings category and section opening and closing.',
    animationDialogsToggle: 'Animate Help, Diagnostics, update, import, and confirmation dialogs.',
    animationViewsToggle: 'Animate transitions between the dashboard and Summary Mode.',
    animationSensorIconsToggle: 'Add lightweight live and hover motion to sensor-card header icons.',
    animationSettingsIconsToggle: 'Apply lightweight live and hover motion to icons throughout Settings.',
    animationSpeedSelect: 'Choose how quickly interface animations complete.',
    animationIntensitySelect: 'Choose how far and strongly animated elements move.',
    resetThemeColorsBtn: 'Reset custom colors to current theme defaults.',
    showFps: 'Show/hide FPS group card.',
    showCpu: 'Show/hide CPU group card.',
    showGpu: 'Show/hide GPU group card.',
    showRam: 'Show/hide RAM group card.',
    showPsu: 'Show/hide PSU group card.',
    showFans: 'Show/hide Fans group card.',
    showNetwork: 'Show/hide Network group card.',
    showLatency: 'Show/hide Ping group card.',
    showDrives: 'Show/hide Drives group card.',
    showApp: 'Show/hide SiR app telemetry group card.',
    showExternal: 'Show/hide Other group card.',
    resetSensorNamesBtn: 'Clear all custom sensor names.',
    sensorHideUntickedBtn: 'Hide unticked sensors in Sensor Selection without changing which sensors are enabled.',
    alertSensorSelect: 'Select a sensor to configure alert thresholds.',
    alertRuleEnabled: 'Enable or disable alert rule for selected sensor.',
    alertOperatorSelect: 'Alert comparison operator.',
    alertThresholdInput: 'Numeric threshold value for alert condition.',
    alertCooldownInput: 'Minimum seconds between repeated alerts.',
    alertSeveritySelect: 'Alert severity level for UI/web/overlay warning state.',
    saveAlertRuleBtn: 'Save alert rule for selected sensor.',
    deleteAlertRuleBtn: 'Delete alert rule for selected sensor.',
    exportSettingsBtn: 'Export current app settings to a JSON file.',
    importSettingsBtn: 'Import settings from a JSON file.',
    settingsProfileSelect: 'Choose a saved settings profile.',
    applySettingsProfileBtn: 'Apply selected profile and reload.',
    saveSettingsProfileBtn: 'Save current settings as a named profile.',
    renameSettingsProfileBtn: 'Rename the selected settings profile.',
    deleteSettingsProfileBtn: 'Delete the selected settings profile.',
    diagnosticsHeaderBtn: 'Open end-user diagnostic checks and copyable support results.',
    providerBuiltin: 'Enable the bundled SiR sensor collector (no separate monitoring app required).',
    providerEnhanced: 'Enable expanded hardware access through the bundled LibreHardwareMonitor library.',
    hardwareAccessDriverInstallBtn: 'Install the bundled low-level driver used for Intel CPU package power and other protected hardware readings.',
    providerRTSS: 'Enable RTSS/MSI shared-memory provider.',
    providerAIDA64: 'Enable AIDA64 shared-memory provider.',
    providerHWiNFO: 'Enable HWiNFO/LHM shared-memory provider.',
    webMonitorEnabled: 'Enable the browser-accessible web monitor.',
    webMonitorAutoStart: 'Auto-start web monitor when app launches.',
    webMonitorHost: 'Host binding for web monitor server.',
    webMonitorPort: 'Port for web monitor server.',
    webMonitorRequireAuth: 'Require a token for web monitor access.',
    webMonitorAuthToken: 'Access token accepted via query token, X-SiR-Token, or Bearer auth.',
    webMonitorReadOnlyApiMode: 'Serve API only and block HTML monitor page.',
    webMonitorGenerateTokenBtn: 'Generate a new random access token and enable token auth.',
    webMonitorCopyTokenBtn: 'Copy the current web monitor access token to clipboard.',
    webMonitorApplyBtn: 'Apply and restart web monitor settings.',
    webMonitorOpenBtn: 'Open web monitor in your default browser.',
    discordPresenceSelect: 'Enable or disable Discord Rich Presence.',
    launchAtStartup: 'Start app automatically with Windows.',
    launchAsAdministrator: 'Request administrator privileges whenever the app starts. Windows will show a UAC prompt.',
    startMinimized: 'Launch app minimized.',
    minimizeToTray: 'Minimize to system tray instead of taskbar.',
    closeToTray: 'Close button hides to tray instead of exiting.',
    autoCheckForUpdates: 'Automatically check for updates when the app starts.',
    startupDelaySeconds: 'Delay app window startup by 0 to 60 seconds.',
    checkForUpdatesBtn: 'Check GitHub releases for updates.',
    openLatestReleaseBtn: 'Open latest release page in browser.'
  };

  Object.entries(tooltips).forEach(([id, text]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.title = text;
    if (!el.getAttribute('aria-label')) {
      el.setAttribute('aria-label', text);
    }
  });

  const perCategoryTooltip = 'Set max overlay lines for this category in grouped-line style.';
  SENSOR_GROUP_ORDER.forEach((group) => {
    const el = document.getElementById(`overlayLineLimit_${group}`);
    if (!el) return;
    el.title = perCategoryTooltip;
    if (!el.getAttribute('aria-label')) {
      el.setAttribute('aria-label', perCategoryTooltip);
    }
  });
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
  let layoutResizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(layoutResizeTimer);
    layoutResizeTimer = setTimeout(applyWindowSizes, 100);
  });
  setupWindowDragAndDrop();
  setupStackedDashboardWheelScroll();
  setupSensorGraphInteractions();
  applyUiTooltips();
  initializeMotionVisibilityTracking();
  document.addEventListener('visibilitychange', syncDesktopActivityState);
  window.addEventListener('focus', syncDesktopActivityState);
  window.addEventListener('blur', syncDesktopActivityState);
  syncDesktopActivityState();
  updateStats();
  restartUpdateTimer();
});

window.addEventListener('beforeunload', () => {
  updateLoopActive = false;
  clearTimeout(updateTimer);
  clearTimeout(ambientMotionTimer);
  stopWebMonitorServer();
  if (sensorReader && typeof sensorReader.close === 'function') sensorReader.close();
});
