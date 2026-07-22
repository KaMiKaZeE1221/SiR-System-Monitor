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
</style>
<script>
  document.addEventListener('DOMContentLoaded', () => {
    document.body.className = 'theme-orange settings-preview';
    const previewParams = new URLSearchParams(location.search);
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
      group.classList.toggle('is-collapsed', !groupOpen);
      button.setAttribute('aria-expanded', groupOpen ? 'true' : 'false');
      button.addEventListener('click', () => {
        const open = group.classList.contains('is-collapsed');
        group.classList.toggle('is-collapsed', !open);
        button.setAttribute('aria-expanded', open ? 'true' : 'false');
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
      section.classList.toggle('is-collapsed', !sectionOpen);
      button.setAttribute('aria-expanded', sectionOpen ? 'true' : 'false');
      button.addEventListener('click', () => {
        const open = section.classList.contains('is-collapsed');
        section.classList.toggle('is-collapsed', !open);
        button.setAttribute('aria-expanded', open ? 'true' : 'false');
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
