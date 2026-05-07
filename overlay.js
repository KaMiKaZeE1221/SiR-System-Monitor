const { ipcRenderer } = require('electron');

const OVERLAY_ENABLED_KEY = 'overlayEnabled';
const OVERLAY_FONT_SIZE_KEY = 'overlayFontSize';
const OVERLAY_FONT_FAMILY_KEY = 'overlayFontFamily';
const OVERLAY_FONT_BOLD_KEY = 'overlayFontBold';
const OVERLAY_TEXT_COLOR_KEY = 'overlayTextColor';
const OVERLAY_VALUE_COLOR_KEY = 'overlayValueColor';
const OVERLAY_BG_COLOR_KEY = 'overlayBackgroundColor';
const OVERLAY_OPACITY_KEY = 'overlayOpacity';
const OVERLAY_SCALE_KEY = 'overlayScale';
const OVERLAY_STYLE_KEY = 'overlayStyle';

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

function loadOverlaySettings() {
  return {
    enabled: localStorage.getItem(OVERLAY_ENABLED_KEY) === 'true',
    fontSize: normalizeOverlayFontSize(localStorage.getItem(OVERLAY_FONT_SIZE_KEY)),
    fontFamily: normalizeOverlayFontFamily(localStorage.getItem(OVERLAY_FONT_FAMILY_KEY)),
    fontBold: normalizeOverlayFontBold(localStorage.getItem(OVERLAY_FONT_BOLD_KEY)),
    textColor: normalizeOverlayColor(localStorage.getItem(OVERLAY_TEXT_COLOR_KEY), '#e0e0e0'),
    valueColor: normalizeOverlayColor(localStorage.getItem(OVERLAY_VALUE_COLOR_KEY), '#ffffff'),
    backgroundColor: normalizeOverlayColor(localStorage.getItem(OVERLAY_BG_COLOR_KEY), '#000000'),
    opacity: normalizeOverlayOpacity(localStorage.getItem(OVERLAY_OPACITY_KEY)),
    scale: normalizeOverlayScale(localStorage.getItem(OVERLAY_SCALE_KEY)),
    style: normalizeOverlayStyle(localStorage.getItem(OVERLAY_STYLE_KEY))
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
  overlayShell.style.setProperty('--overlay-font', settings.fontFamily);
  overlayShell.style.setProperty('--overlay-weight', settings.fontBold ? '700' : '500');
  overlayShell.style.setProperty('--overlay-text', settings.textColor);
  overlayShell.style.setProperty('--overlay-value', settings.valueColor);
  overlayShell.style.setProperty('--overlay-gap', `${settings.groupSpacing ?? 8}px`);
  overlayShell.style.setProperty('--overlay-unit-scale', settings.scale / 100);

  const bgRgb = hexToRgb(settings.backgroundColor);
  const bgRgba = bgRgb ? `rgba(${bgRgb.r}, ${bgRgb.g}, ${bgRgb.b}, ${settings.opacity / 100})` : `rgba(0,0,0,${settings.opacity / 100})`;
  overlayShell.style.setProperty('--overlay-bg', bgRgba);
  if (settings.opacity > 0) {
    overlayShell.style.background = bgRgba;
  } else {
    overlayShell.style.background = 'transparent';
  }
  overlayShell.style.borderColor = `rgba(255,255,255,${Math.min(0.14, settings.opacity / 100)})`;
}

function normalizeOverlayGroupLabel(group) {
  const raw = String(group || '').trim();
  if (!raw) return 'General';
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
  return `<div class="${classes.join(' ')}"><span class="overlay-label">${escapeHtml(label)}</span><span class="overlay-value">${escapeHtml(display)}</span></div>`;
}

function renderOverlay(payload) {
  const settings = payload?.settings || loadOverlaySettings();
  applyOverlayAppearance(settings);
  const sensors = Array.isArray(payload?.sensors) ? payload.sensors : [];
  if (!overlayContent || !overlayMessage) return;

  if (!sensors.length) {
    overlayContent.innerHTML = '<div class="overlay-message">No sensors selected or no data available.</div>';
    return;
  }

  if (settings.style === 'grouped' || settings.style === 'category' || settings.style === 'grouped-line') {
    const grouped = sensors.reduce((acc, sensor) => {
      const groupLabel = normalizeOverlayGroupLabel(sensor.group || sensor.category);
      if (!acc[groupLabel]) acc[groupLabel] = [];
      acc[groupLabel].push(sensor);
      return acc;
    }, {});

    if (settings.style === 'grouped-line') {
      const html = Object.keys(grouped).map((groupLabel) => {
        const items = grouped[groupLabel].map((sensor) => {
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
          return `<span class="overlay-group-line-item">${escapeHtml(display)}</span>`;
        }).join('');

        return `
          <div class="overlay-group overlay-group-line">
            <span class="overlay-group-title">${escapeHtml(groupLabel)}</span>
            <span class="overlay-group-values">${items}</span>
          </div>`;
      }).join('');

      overlayContent.innerHTML = html;
      requestOverlayResize(settings);
      return;
    }

    const html = Object.keys(grouped).map((groupLabel) => {
      const items = grouped[groupLabel].map((sensor) => renderOverlayItem(sensor, settings)).join('');
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
  lastPosition: null
};

function requestOverlayResize(settings) {
  if (!overlayShell || !overlayContent) return;

  const measure = () => {
    if (!overlayShell || !overlayContent) return null;

    let maxWidth = 280;
    const groupLines = overlayContent.querySelectorAll('.overlay-group-line');

    if (groupLines.length > 0) {
      // For grouped-line style, measure each line carefully
      groupLines.forEach((line) => {
        const title = line.querySelector('.overlay-group-title');
        const values = line.querySelector('.overlay-group-values');
        if (title && values) {
          const titleRect = title.getBoundingClientRect();
          const valuesRect = values.getBoundingClientRect();
          const lineWidth = titleRect.width + valuesRect.width + 14;
          maxWidth = Math.max(maxWidth, lineWidth);
        }
      });
    } else {
      // For other styles, use content width
      const contentWidth = Math.max(overlayContent.scrollWidth, overlayContent.offsetWidth, overlayContent.clientWidth);
      const shellWidth = Math.max(overlayShell.scrollWidth, overlayShell.offsetWidth, overlayShell.clientWidth);
      maxWidth = Math.max(maxWidth, contentWidth, shellWidth);
    }

    const width = Math.max(280, Math.ceil(maxWidth + 48));
    const contentHeight = Math.max(overlayContent.scrollHeight, overlayContent.offsetHeight, overlayContent.clientHeight);
    const shellHeight = Math.max(overlayShell.scrollHeight, overlayShell.offsetHeight, overlayShell.clientHeight);
    const height = Math.max(80, Math.ceil(Math.max(contentHeight, shellHeight) + 24));
    return { width, height };
  };

  const sendResize = () => {
    const dims = measure();
    if (!dims) return;

    const position = String(settings.position || '');
    const sizeChanged = Math.abs(dims.width - overlayResizeState.lastWidth) > 6 || Math.abs(dims.height - overlayResizeState.lastHeight) > 6;
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
  }, 80);
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

window.addEventListener('DOMContentLoaded', () => {
  applyOverlayAppearance();
  if (loadOverlaySettings().enabled === false) {
    ipcRenderer.invoke('overlay:set-enabled', false).catch(() => {});
  }
});

window.addEventListener('storage', (event) => {
  if ([OVERLAY_FONT_SIZE_KEY, OVERLAY_FONT_FAMILY_KEY, OVERLAY_FONT_BOLD_KEY, OVERLAY_TEXT_COLOR_KEY, OVERLAY_VALUE_COLOR_KEY, OVERLAY_BG_COLOR_KEY, OVERLAY_OPACITY_KEY, OVERLAY_SCALE_KEY, OVERLAY_STYLE_KEY].includes(event.key)) {
    applyOverlayAppearance();
  }
});
