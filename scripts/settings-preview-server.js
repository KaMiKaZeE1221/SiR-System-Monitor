'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = Math.max(1024, Math.min(65535, Number(process.argv[2]) || 17492));

const previewScript = `
<style>
  body.settings-preview { display: block; overflow: hidden; }
  body.settings-preview .sidebar { width: 460px !important; min-width: 460px !important; height: 100vh; max-height: none; border-right: 0; }
  body.settings-preview .container,
  body.settings-preview .sidebar-resize-handle,
  body.settings-preview .setup-guide-modal { display: none !important; }
  body.settings-preview.slow-motion-preview .settings-group-content,
  body.settings-preview.slow-motion-preview .settings-section-content {
    transition-duration: 2s !important;
  }
</style>
<script>
  document.addEventListener('DOMContentLoaded', () => {
    document.body.className = 'theme-orange settings-preview';
    const previewParams = new URLSearchParams(location.search);
    const slowMotionPreview = previewParams.get('slowMotion') === '1';
    document.body.classList.toggle('slow-motion-preview', slowMotionPreview);
    const requestedWidth = Math.max(300, Math.min(620, Number(previewParams.get('width')) || 460));
    const requestedPanelColor = String(previewParams.get('panelColor') || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(requestedPanelColor)) {
      document.body.style.setProperty('--settings-panel-color', requestedPanelColor);
    }
    const requestedSettingsAccent = String(previewParams.get('settingsAccent') || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(requestedSettingsAccent)) {
      document.body.style.setProperty('--settings-panel-accent-color', requestedSettingsAccent);
    }
    const requestedSettingsIcon = String(previewParams.get('settingsIcon') || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(requestedSettingsIcon)) {
      document.body.style.setProperty('--settings-panel-icon-color', requestedSettingsIcon);
    }
    const animationDefaults = { enabled: true, settingsDropdowns: true, dialogs: true, viewTransitions: true, sensorIcons: true, settingsIcons: true, speed: 'standard', intensity: 'balanced' };
    let animationSettings = { ...animationDefaults };
    try {
      animationSettings = { ...animationDefaults, ...JSON.parse(localStorage.getItem('animationSettings') || '{}') };
    } catch (error) {}
    const animationSpeedPresets = {
      calm: { iconMs: 6200, focusMs: 650, dialogMs: 320, viewMs: 440, groupMs: 420, sectionMs: 360 },
      standard: { iconMs: 4800, focusMs: 500, dialogMs: 240, viewMs: 340, groupMs: 320, sectionMs: 280 },
      lively: { iconMs: 3600, focusMs: 380, dialogMs: 180, viewMs: 260, groupMs: 250, sectionMs: 220 }
    };
    const animationIntensityPresets = {
      gentle: { iconLift: .75, iconScale: 1.04, focusRotate: -4, focusScale: 1.1, viewDistance: 6, viewScale: .992, dialogDistance: 12, disclosureDistance: 3 },
      balanced: { iconLift: 1.5, iconScale: 1.08, focusRotate: -8, focusScale: 1.2, viewDistance: 10, viewScale: .985, dialogDistance: 20, disclosureDistance: 5 },
      expressive: { iconLift: 2.5, iconScale: 1.13, focusRotate: -12, focusScale: 1.28, viewDistance: 15, viewScale: .976, dialogDistance: 28, disclosureDistance: 8 }
    };
    const animationInputs = {
      animationEnabledToggle: 'enabled',
      animationSettingsToggle: 'settingsDropdowns',
      animationDialogsToggle: 'dialogs',
      animationViewsToggle: 'viewTransitions',
      animationSensorIconsToggle: 'sensorIcons',
      animationSettingsIconsToggle: 'settingsIcons'
    };
    const applyAnimationPreference = () => {
      animationSettings.speed = animationSpeedPresets[animationSettings.speed] ? animationSettings.speed : 'standard';
      animationSettings.intensity = animationIntensityPresets[animationSettings.intensity] ? animationSettings.intensity : 'balanced';
      const speed = animationSpeedPresets[animationSettings.speed];
      const intensity = animationIntensityPresets[animationSettings.intensity];
      document.documentElement.style.setProperty('--motion-icon-duration', speed.iconMs + 'ms');
      document.documentElement.style.setProperty('--motion-focus-duration', speed.focusMs + 'ms');
      document.documentElement.style.setProperty('--motion-dialog-duration', speed.dialogMs + 'ms');
      document.documentElement.style.setProperty('--motion-view-duration', speed.viewMs + 'ms');
      document.documentElement.style.setProperty('--motion-settings-group-duration', speed.groupMs + 'ms');
      document.documentElement.style.setProperty('--motion-settings-section-duration', speed.sectionMs + 'ms');
      document.documentElement.style.setProperty('--motion-icon-lift', intensity.iconLift + 'px');
      document.documentElement.style.setProperty('--motion-icon-scale', String(intensity.iconScale));
      document.documentElement.style.setProperty('--motion-focus-rotate', intensity.focusRotate + 'deg');
      document.documentElement.style.setProperty('--motion-focus-scale', String(intensity.focusScale));
      document.documentElement.style.setProperty('--motion-view-distance', intensity.viewDistance + 'px');
      document.documentElement.style.setProperty('--motion-view-scale', String(intensity.viewScale));
      document.documentElement.style.setProperty('--motion-dialog-distance', intensity.dialogDistance + 'px');
      document.documentElement.style.setProperty('--motion-disclosure-distance', intensity.disclosureDistance + 'px');
      document.body.classList.toggle('no-settings-animations', !animationSettings.enabled || !animationSettings.settingsDropdowns);
      document.body.classList.toggle('no-dialog-animations', !animationSettings.enabled || !animationSettings.dialogs);
      document.body.classList.toggle('no-view-animations', !animationSettings.enabled || !animationSettings.viewTransitions);
      document.body.classList.toggle('no-sensor-icon-animations', !animationSettings.enabled || !animationSettings.sensorIcons);
      document.body.classList.toggle('no-settings-icon-animations', !animationSettings.enabled || !animationSettings.settingsIcons);
      const features = document.getElementById('animationFeatureControls');
      if (features) features.classList.toggle('is-disabled', !animationSettings.enabled);
      const presets = document.getElementById('animationPresetControls');
      if (presets) presets.classList.toggle('is-disabled', !animationSettings.enabled);
      Object.entries(animationInputs).forEach(([id, key]) => {
        const input = document.getElementById(id);
        if (!input) return;
        input.checked = animationSettings[key] !== false;
        if (key !== 'enabled') input.disabled = !animationSettings.enabled;
      });
      const speedSelect = document.getElementById('animationSpeedSelect');
      const intensitySelect = document.getElementById('animationIntensitySelect');
      if (speedSelect) { speedSelect.value = animationSettings.speed; speedSelect.disabled = !animationSettings.enabled; }
      if (intensitySelect) { intensitySelect.value = animationSettings.intensity; intensitySelect.disabled = !animationSettings.enabled; }
      localStorage.setItem('animationSettings', JSON.stringify(animationSettings));
    };
    Object.entries(animationInputs).forEach(([id, key]) => {
      const input = document.getElementById(id);
      if (!input) return;
      input.addEventListener('change', () => {
        animationSettings = { ...animationSettings, [key]: !!input.checked };
        applyAnimationPreference();
      });
    });
    [['animationSpeedSelect', 'speed'], ['animationIntensitySelect', 'intensity']].forEach(([id, key]) => {
      const select = document.getElementById(id);
      if (!select) return;
      select.addEventListener('change', () => {
        animationSettings = { ...animationSettings, [key]: select.value };
        applyAnimationPreference();
      });
    });
    applyAnimationPreference();
    const setDisclosureExpanded = (owner, button, content, expanded, animate) => {
      const shouldAnimate = animate !== false
        && !document.body.classList.contains('no-settings-animations');
      button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      content.setAttribute('aria-hidden', expanded ? 'false' : 'true');
      content.toggleAttribute('inert', !expanded);
      if (!shouldAnimate) {
        owner.classList.toggle('is-collapsed', !expanded);
        content.style.removeProperty('max-height');
        return;
      }
      const startHeight = content.getBoundingClientRect().height;
      content.classList.add('is-settings-disclosure-preparing');
      content.style.maxHeight = Math.max(0, startHeight) + 'px';
      void content.offsetHeight;
      content.classList.remove('is-settings-disclosure-preparing');
      void content.offsetHeight;
      content.classList.add('is-settings-disclosure-animating');
      const speed = animationSpeedPresets[animationSettings.speed] || animationSpeedPresets.standard;
      const durationMs = slowMotionPreview ? 2000 : (content.classList.contains('settings-group-content') ? speed.groupMs : speed.sectionMs);
      let finished = false;
      const finish = (event) => {
        if (event && (event.target !== content || event.propertyName !== 'max-height')) return;
        if (finished) return;
        finished = true;
        content.removeEventListener('transitionend', finish);
        content.classList.remove('is-settings-disclosure-animating', 'is-settings-disclosure-preparing');
        owner.classList.toggle('is-collapsed', !expanded);
        content.style.removeProperty('max-height');
      };
      content.addEventListener('transitionend', finish);
      requestAnimationFrame(() => {
        owner.classList.toggle('is-collapsed', !expanded);
        const targetHeight = expanded ? content.scrollHeight : 0;
        content.style.maxHeight = Math.max(0, targetHeight) + 'px';
      });
      setTimeout(() => finish(), durationMs + 180);
    };
    const previewSidebar = document.querySelector('.sidebar');
    if (previewSidebar) {
      previewSidebar.style.setProperty('width', requestedWidth + 'px', 'important');
      previewSidebar.style.setProperty('min-width', requestedWidth + 'px', 'important');
    }
    const presentation = {
      'Appearance': ['bi-palette2', 'Theme, typography, dashboard layout and overlay'],
      'Monitoring': ['bi-activity', 'Sources, sensor visibility, ordering and alerts'],
      'Backup / Restore': ['bi-shield-check', 'Profiles, settings import and export'],
      'Connectivity': ['bi-broadcast', 'Web Monitor and Discord presence'],
      'App Behavior': ['bi-window-stack', 'Startup, system tray and application updates']
    };
    document.querySelectorAll('.sidebar .settings-group').forEach((group) => {
      const title = group.querySelector(':scope > .settings-group-title');
      const name = title ? title.textContent.trim() : 'Settings';
      const meta = presentation[name] || ['bi-sliders2-vertical', 'Application settings'];
      const content = document.createElement('div');
      content.className = 'settings-group-content';
      [...group.children].filter((child) => child !== title).forEach((child) => content.appendChild(child));
      if (title) title.remove();
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'settings-group-toggle-btn';
      button.innerHTML = '<span class="settings-group-toggle-main"><span class="settings-group-toggle-mark"><i class="bi ' + meta[0] + '"></i></span><span class="settings-group-toggle-copy"><span class="settings-group-toggle-title">' + name + '</span><span class="settings-group-toggle-description">' + meta[1] + '</span></span></span><span class="settings-group-toggle-icon"><i class="bi bi-chevron-down"></i></span>';
      group.append(button, content);
      const groupOpen = name === 'Appearance';
      setDisclosureExpanded(group, button, content, groupOpen, false);
      button.addEventListener('click', () => {
        const open = group.classList.contains('is-collapsed');
        setDisclosureExpanded(group, button, content, open, true);
      });
    });
    document.querySelectorAll('.sidebar .settings-section').forEach((section) => {
      const label = section.querySelector(':scope > .settings-label');
      const name = label ? label.textContent.trim() : 'Setting';
      const icon = label && label.querySelector('.settings-label-icon');
      const content = document.createElement('div');
      content.className = 'settings-section-content';
      [...section.children].filter((child) => child !== label).forEach((child) => content.appendChild(child));
      if (label) label.remove();
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'settings-toggle-btn';
      button.innerHTML = '<span class="settings-toggle-title">' + (icon ? '<i class="' + icon.className + '"></i>' : '') + '<span>' + name + '</span></span><span class="settings-toggle-icon">▾</span>';
      section.append(button, content);
      const sectionOpen = name === 'On-Screen Overlay';
      setDisclosureExpanded(section, button, content, sectionOpen, false);
      button.addEventListener('click', () => {
        const open = section.classList.contains('is-collapsed');
        setDisclosureExpanded(section, button, content, open, true);
      });
    });
    const orderList = document.getElementById('overlayCategoryOrderList');
    if (orderList) {
      ['FPS', 'CPU', 'GPU', 'Memory', 'PSU', 'Fans', 'Network', 'Ping', 'Drives', 'App', 'Other'].forEach((name, index) => {
        orderList.insertAdjacentHTML('beforeend', '<div class="overlay-category-order-item"><span class="overlay-category-order-handle">⋮⋮</span><span class="overlay-category-order-label">' + name + '</span><span class="overlay-category-order-position">' + (index + 1) + '</span></div>');
      });
    }
    window.__SETTINGS_PREVIEW_READY__ = true;
  });
</script>`;

function sendFile(response, filePath, contentType) {
  response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  response.end(fs.readFileSync(filePath));
}

const server = http.createServer((request, response) => {
  const requestPath = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
  if (requestPath === '/' || requestPath === '/index.html') {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
      .replace('<script src="app.js"></script>', previewScript);
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(html);
    return;
  }
  if (requestPath === '/styles.css') return sendFile(response, path.join(root, 'styles.css'), 'text/css; charset=utf-8');
  if (requestPath === '/SiR_SM_Circle.ico') return sendFile(response, path.join(root, 'SiR_SM_Circle.ico'), 'image/x-icon');
  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Not found');
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Settings preview ready at http://127.0.0.1:${port}/\n`);
});
