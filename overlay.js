const { ipcRenderer } = require('electron');

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
const OVERLAY_CUSTOM_X_KEY = 'overlayCustomX';
const OVERLAY_CUSTOM_Y_KEY = 'overlayCustomY';
const OVERLAY_CUSTOM_POSITION_ENABLED_KEY = 'overlayCustomPositionEnabled';
const OVERLAY_DRAG_UNLOCK_KEY = 'overlayDragUnlock';

const overlayShell = document.getElementById('overlayShell');
const overlayContent = document.getElementById('overlayContent');
const overlayMessage = document.getElementById('overlayMessage');

function normalizeOverlayFontSize(size) {
  return ['small', 'medium', 'large', 'xlarge', 'xxlarge'].includes(size) ? size : 'medium';
}

function normalizeOverlayFontFamily(family) {
  const map = {
    segoe: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
    arial: 'Arial, Helvetica, sans-serif',
    verdana: 'Verdana, Geneva, sans-serif',
    tahoma: "Tahoma, 'Segoe UI', sans-serif",
    georgia: "Georgia, 'Times New Roman', serif",
    calibri: 'Calibri, Candara, "Segoe UI", sans-serif',
    trebuchet: "'Trebuchet MS', 'Segoe UI', sans-serif",
    cambria: 'Cambria, Georgia, serif',
    garamond: "Garamond, 'Times New Roman', serif",
    consolas: 'Consolas, "Courier New", monospace',
    monospace: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
  };
  return map[family] || map.segoe;
}

function normalizeOverlayColor(value, fallback) {
  const normalized = String(value || '').trim();
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

function normalizeOverlayScale(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 100;
  return Math.max(50, Math.min(200, Math.round(numeric)));
}

function normalizeOverlayStyle(value) {
  const valid = ['compact', 'grouped', 'category', 'grouped-line'];
  return valid.includes(String(value || '').trim()) ? String(value).trim() : 'compact';
}

function normalizeOverlayGroupSpacing(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(32, Math.round(numeric)));
}

function normalizeOverlayWidthPreset(value) {
  const valid = ['small', 'medium', 'large', 'wide', 'custom'];
  return valid.includes(String(value || '').trim()) ? String(value).trim() : 'medium';
}

function normalizeOverlayWidth(value, preset = 'medium') {
  const presets = { small: 280, medium: 360, large: 460, wide: 560 };
  const normalizedPreset = normalizeOverlayWidthPreset(preset);
  if (normalizedPreset !== 'custom') return presets[normalizedPreset] || presets.medium;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(260, Math.min(1000, Math.round(numeric / 10) * 10)) : presets.medium;
}

function normalizeGroupLineLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 8;
  return Math.max(1, Math.min(40, Math.round(numeric)));
}

function normalizeOverlayGroupLineLimits(raw) {
  const groups = ['fps', 'cpu', 'gpu', 'ram', 'psu', 'fans', 'network', 'latency', 'drives', 'other'];
  const defaults = {};
  groups.forEach((group) => { defaults[group] = 8; });
  const input = (raw && typeof raw === 'object') ? raw : {};
  groups.forEach((group) => {
    defaults[group] = normalizeGroupLineLimit(input[group]);
  });
  return defaults;
}

function loadOverlaySettings() {
  const widthPreset = normalizeOverlayWidthPreset(localStorage.getItem(OVERLAY_WIDTH_PRESET_KEY));
  const customXRaw = localStorage.getItem(OVERLAY_CUSTOM_X_KEY);
  const customYRaw = localStorage.getItem(OVERLAY_CUSTOM_Y_KEY);
  const customX = Number(customXRaw);
  const customY = Number(customYRaw);
  const customPositionEnabled = String(localStorage.getItem(OVERLAY_CUSTOM_POSITION_ENABLED_KEY) || '').trim().toLowerCase() === 'true'
    && customXRaw !== null
    && customYRaw !== null
    && Number.isFinite(customX)
    && Number.isFinite(customY);
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
    position: String(localStorage.getItem(OVERLAY_POSITION_KEY) || 'top-right'),
    style: normalizeOverlayStyle(localStorage.getItem(OVERLAY_STYLE_KEY)),
    showUnits: String(localStorage.getItem(OVERLAY_SHOW_UNITS_KEY) || '').trim().toLowerCase() !== 'false',
    displayId: localStorage.getItem(OVERLAY_MONITOR_KEY) || '',
    customPositionEnabled,
    customX: customPositionEnabled ? Math.round(customX) : null,
    customY: customPositionEnabled ? Math.round(customY) : null,
    groupLineLimits: normalizeOverlayGroupLineLimits((() => {
      try {
        return JSON.parse(localStorage.getItem('overlayGroupLineLimits') || '{}');
      } catch (e) {
        return {};
      }
    })()),
    dragUnlock: String(localStorage.getItem(OVERLAY_DRAG_UNLOCK_KEY) || '').trim().toLowerCase() === 'true'
  };
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

function applyOverlayAppearance(settings = loadOverlaySettings()) {
  if (!overlayShell) return;

  overlayShell.classList.remove('font-small', 'font-medium', 'font-large', 'font-xlarge', 'font-xxlarge');
  overlayShell.classList.add(`font-${settings.fontSize}`);
  overlayShell.classList.remove(
    'overlay-style-compact',
    'overlay-style-card',
    'overlay-style-grouped',
    'overlay-style-category',
    'overlay-style-horizontal',
    'overlay-style-grouped-line'
  );
  overlayShell.classList.add(`overlay-style-${settings.style}`);
  const resolvedFontFamily = String(settings.fontFamily || '').includes(',')
    ? String(settings.fontFamily)
    : normalizeOverlayFontFamily(settings.fontFamily);
  overlayShell.style.setProperty('--overlay-font', resolvedFontFamily);
  overlayShell.style.setProperty('--overlay-weight', settings.fontBold ? '700' : '500');
  overlayShell.style.setProperty('--overlay-text', settings.textColor);
  overlayShell.style.setProperty('--overlay-value', settings.valueColor);
  overlayShell.style.setProperty('--overlay-gap', `${normalizeOverlayGroupSpacing(settings.groupSpacing)}px`);
  overlayShell.style.setProperty('--overlay-unit-scale', settings.scale / 100);
  const configuredWidth = normalizeOverlayWidth(settings.width, settings.widthPreset || 'custom');
  const targetWidth = settings.style === 'grouped-line'
    ? Math.max(configuredWidth, Number(overlayResizeState.lastWidth) || 0)
    : configuredWidth;
  overlayShell.style.width = `${targetWidth}px`;
  overlayShell.style.minWidth = '0';
  if (overlayContent) overlayContent.style.width = '100%';

  const bgRgb = hexToRgb(settings.backgroundColor);
  const normalizedOpacity = Math.max(0, Math.min(100, Number(settings.opacity) || 0));
  const overlayAlpha = normalizedOpacity / 100;
  const bgRgba = bgRgb ? `rgba(${bgRgb.r}, ${bgRgb.g}, ${bgRgb.b}, ${overlayAlpha})` : `rgba(0,0,0,${overlayAlpha})`;
  overlayShell.style.setProperty('--overlay-bg', bgRgba);
  overlayShell.style.setProperty('--overlay-border', `rgba(255,255,255,${Math.min(0.14, overlayAlpha * 0.2)})`);
  overlayShell.style.setProperty('--overlay-surface-alpha', String(Math.max(0, overlayAlpha * 0.09)));
  overlayShell.style.setProperty('--overlay-surface-border-alpha', String(Math.max(0, overlayAlpha * 0.16)));
  if (normalizedOpacity > 0) {
    overlayShell.classList.remove('overlay-transparent-bg');
    overlayShell.style.background = bgRgba;
  } else {
    overlayShell.classList.add('overlay-transparent-bg');
    overlayShell.style.background = 'transparent';
  }
  overlayShell.style.borderColor = `rgba(255,255,255,${Math.min(0.14, overlayAlpha * 0.2)})`;
  overlayShell.style.cursor = settings.dragUnlock ? 'move' : 'default';
}

function normalizeOverlayGroupLabel(group) {
  const raw = String(group || '').trim();
  if (!raw) return 'General';
  if (raw.toLowerCase() === 'network') return 'NET';
  if (raw.toLowerCase() === 'latency') return 'PING';
  return raw
    .replace(/[-_]+/g, ' ')
    .replace(/(^|\s)([a-z])/g, (match, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
}

function renderOverlayItem(sensor, settings) {
  const label = String(sensor.displayLabel || sensor.name || sensor.id || 'Sensor').trim();
  const value = String(sensor.displayValue ?? sensor.value ?? '--').trim();
  const showUnits = settings.showUnits !== false;
  let display = value;
  if (showUnits) {
    if (sensor.formatted) {
      display = String(sensor.formatted || value).trim();
    } else if (sensor.displayUnits) {
      display = `${value} ${String(sensor.displayUnits).trim()}`;
    }
  }
  const classes = ['overlay-item'];
  if (settings.style === 'card') classes.push('overlay-item-card');
  if (sensor.alertSeverity === 'warning') classes.push('overlay-item-alert-warning');
  if (sensor.alertSeverity === 'critical') classes.push('overlay-item-alert-critical');
  return `<div class="${classes.join(' ')}"><span class="overlay-label">${escapeHtml(label)}</span><span class="overlay-value">${escapeHtml(display)}</span></div>`;
}

function renderOverlay(payload) {
  const settings = payload?.settings || loadOverlaySettings();
  const sensors = Array.isArray(payload?.sensors) ? payload.sensors : [];
  if (!overlayContent || !overlayMessage) return;

  const resizeLayoutKey = JSON.stringify({
    style: settings.style,
    widthPreset: settings.widthPreset,
    width: settings.width,
    fontSize: settings.fontSize,
    fontFamily: settings.fontFamily,
    fontBold: settings.fontBold,
    scale: settings.scale,
    groupSpacing: settings.groupSpacing,
    groupLineLimits: settings.groupLineLimits,
    sensors: sensors.map((sensor) => `${sensor.group || sensor.category || ''}:${sensor.id || sensor.name || ''}`)
  });
  if (overlayResizeState.layoutKey !== resizeLayoutKey) {
    overlayResizeState.layoutKey = resizeLayoutKey;
    overlayResizeState.lastWidth = 0;
    overlayResizeState.lastHeight = 0;
  }
  applyOverlayAppearance(settings);

  if (!sensors.length) {
    overlayContent.innerHTML = '<div class="overlay-message">No sensors selected or no data available.</div>';
    requestOverlayResize(settings);
    return;
  }

  if (settings.style === 'grouped' || settings.style === 'category' || settings.style === 'grouped-line') {
    const grouped = sensors.reduce((acc, sensor) => {
      const groupKey = String(sensor.group || sensor.category || 'other').trim().toLowerCase() || 'other';
      const groupLabel = normalizeOverlayGroupLabel(sensor.group || sensor.category);
      if (!acc[groupLabel]) acc[groupLabel] = { key: groupKey, sensors: [] };
      acc[groupLabel].sensors.push(sensor);
      return acc;
    }, {});

    if (settings.style === 'grouped-line') {
      const html = Object.keys(grouped).map((groupLabel) => {
        const groupEntry = grouped[groupLabel] || { key: 'other', sensors: [] };
        const renderedItems = groupEntry.sensors.map((sensor) => {
          const value = String(sensor.displayValue ?? sensor.value ?? '--').trim();
          const showUnits = settings.showUnits !== false;
          let display = value;
          if (showUnits) {
            if (sensor.formatted) {
              display = String(sensor.formatted || value).trim();
            } else if (sensor.displayUnits) {
              display = `${value} ${String(sensor.displayUnits).trim()}`;
            }
          }
          const severityClass = sensor.alertSeverity === 'critical'
            ? ' overlay-group-line-item-alert-critical'
            : (sensor.alertSeverity === 'warning' ? ' overlay-group-line-item-alert-warning' : '');
          return `<span class="overlay-group-line-item${severityClass}">${escapeHtml(display)}</span>`;
        });
        const hasCritical = groupEntry.sensors.some((sensor) => sensor.alertSeverity === 'critical');
        const hasWarning = !hasCritical && groupEntry.sensors.some((sensor) => sensor.alertSeverity === 'warning');
        const groupAlertClass = hasCritical
          ? ' overlay-group-alert-critical'
          : (hasWarning ? ' overlay-group-alert-warning' : '');
        const perGroupLimits = normalizeOverlayGroupLineLimits(settings.groupLineLimits);
        const lineLimit = normalizeGroupLineLimit(perGroupLimits[groupEntry.key] ?? 8);
        const chunkSize = Math.max(1, Math.ceil(renderedItems.length / lineLimit));
        const chunks = [];
        for (let i = 0; i < renderedItems.length; i += chunkSize) {
          const chunk = renderedItems.slice(i, i + chunkSize)
            .map((item, index) => `<span class="overlay-group-line-token">${index ? '<span class="overlay-group-line-sep">|</span>' : ''}${item}</span>`)
            .join('');
          chunks.push(chunk);
          if (chunks.length >= lineLimit) break;
        }
        const values = chunks.map((chunk) => `<span class="overlay-group-values">${chunk}</span>`).join('');

        return `
          <div class="overlay-group overlay-group-line${groupAlertClass}">
            <span class="overlay-group-title">${escapeHtml(groupLabel)}</span>
            ${values}
          </div>`;
      }).join('');

      overlayContent.innerHTML = html;
      requestOverlayResize(settings);
      return;
    }

    const html = Object.keys(grouped).map((groupLabel) => {
      const items = (grouped[groupLabel].sensors || []).map((sensor) => renderOverlayItem(sensor, settings)).join('');
      return `
        <div class="overlay-group ${settings.style === 'category' ? 'overlay-group-category' : 'overlay-group-box'}">
          <div class="overlay-group-title">${escapeHtml(groupLabel)}</div>
          <div class="overlay-group-list">${items}</div>
        </div>`;
    }).join('');

    overlayContent.innerHTML = html;
    requestOverlayResize(settings);
    return;
  }

  overlayContent.innerHTML = sensors.map((sensor) => renderOverlayItem(sensor, settings)).join('');
  requestOverlayResize(settings);
}

const overlayResizeState = {
  timeoutId: null,
  lastWidth: 0,
  lastHeight: 0,
  lastPosition: null,
  layoutKey: ''
};

const overlayDragState = {
  active: false
};

function requestOverlayResize(settings) {
  if (!overlayShell || !overlayContent) return;

  const measure = () => {
    if (!overlayShell || !overlayContent) return null;
    const configuredWidth = normalizeOverlayWidth(settings.width, settings.widthPreset || 'custom');
    let width = configuredWidth;
    if (settings.style === 'grouped-line') {
      const availableScreenWidth = Math.max(260, Number(window.screen?.availWidth || 1202) - 2);
      const requiredWidth = Math.ceil(Math.max(
        configuredWidth,
        overlayContent.scrollWidth + 2,
        ...Array.from(overlayContent.querySelectorAll('.overlay-group-line')).map((line) => line.scrollWidth + 22)
      ));
      width = Math.min(availableScreenWidth, Math.max(requiredWidth, overlayResizeState.lastWidth || 0));
      overlayShell.style.width = `${width}px`;
      overlayContent.style.width = '100%';
    }
    const contentHeight = Math.max(overlayContent.scrollHeight, Math.ceil(overlayContent.getBoundingClientRect().height));
    const shellHeight = Math.max(overlayShell.scrollHeight, Math.ceil(overlayShell.getBoundingClientRect().height));
    const rawHeight = Math.max(60, Math.ceil(Math.max(contentHeight, shellHeight) + 2));
    const height = Math.ceil(rawHeight / 4) * 4;
    return { width, height };
  };

  const sendResize = () => {
    const dims = measure();
    if (!dims) return;

    const position = JSON.stringify({
      position: String(settings.position || ''),
      displayId: String(settings.displayId || ''),
      customPositionEnabled: settings.customPositionEnabled === true,
      customX: Number.isFinite(Number(settings.customX)) ? Math.round(Number(settings.customX)) : null,
      customY: Number.isFinite(Number(settings.customY)) ? Math.round(Number(settings.customY)) : null
    });
    const sizeChanged = Math.abs(dims.width - overlayResizeState.lastWidth) > 1 || Math.abs(dims.height - overlayResizeState.lastHeight) > 1;
    const positionChanged = position !== String(overlayResizeState.lastPosition || '');

    if (!sizeChanged && !positionChanged) {
      return;
    }

    overlayResizeState.lastWidth = dims.width;
    overlayResizeState.lastHeight = dims.height;
    overlayResizeState.lastPosition = position;

    ipcRenderer.send('overlay:resize', {
      settings,
      width: dims.width,
      height: dims.height,
      position: settings.position
    });
  };

  if (overlayResizeState.timeoutId) {
    clearTimeout(overlayResizeState.timeoutId);
  }

  overlayResizeState.timeoutId = window.setTimeout(() => {
    requestAnimationFrame(sendResize);
    overlayResizeState.timeoutId = null;
  }, 100);
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

ipcRenderer.on('overlay:update', (_event, payload) => {
  renderOverlay(payload);
});

if (overlayShell) {
  overlayShell.addEventListener('mousedown', (event) => {
    const settings = loadOverlaySettings();
    if (!settings.dragUnlock) return;
    if (event.button !== 0) return;
    overlayDragState.active = true;
    ipcRenderer.send('overlay:drag-begin', { screenX: event.screenX, screenY: event.screenY });
    event.preventDefault();
  });

  window.addEventListener('mousemove', (event) => {
    if (!overlayDragState.active) return;
    ipcRenderer.send('overlay:drag-move', { screenX: event.screenX, screenY: event.screenY });
  });

  window.addEventListener('mouseup', () => {
    if (!overlayDragState.active) return;
    overlayDragState.active = false;
    ipcRenderer.send('overlay:drag-end');
  });
}

window.addEventListener('DOMContentLoaded', () => {
  applyOverlayAppearance();
  if (loadOverlaySettings().enabled === false) {
    ipcRenderer.invoke('overlay:set-enabled', false).catch(() => {});
  }
});

window.addEventListener('storage', (event) => {
  if ([OVERLAY_FONT_SIZE_KEY, OVERLAY_FONT_FAMILY_KEY, OVERLAY_FONT_BOLD_KEY, OVERLAY_TEXT_COLOR_KEY, OVERLAY_VALUE_COLOR_KEY, OVERLAY_BG_COLOR_KEY, OVERLAY_OPACITY_KEY, OVERLAY_GROUP_SPACING_KEY, OVERLAY_SCALE_KEY, OVERLAY_WIDTH_KEY, OVERLAY_WIDTH_PRESET_KEY, OVERLAY_POSITION_KEY, OVERLAY_STYLE_KEY, OVERLAY_SHOW_UNITS_KEY, OVERLAY_MONITOR_KEY, OVERLAY_CUSTOM_X_KEY, OVERLAY_CUSTOM_Y_KEY, OVERLAY_CUSTOM_POSITION_ENABLED_KEY, OVERLAY_DRAG_UNLOCK_KEY].includes(event.key)) {
    const settings = loadOverlaySettings();
    applyOverlayAppearance(settings);
    requestOverlayResize(settings);
  }
});
