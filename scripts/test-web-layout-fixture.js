'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { getLayoutPreset, normalizeLayoutPreset } = require('../layoutPresets');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const startMarker = 'return `<!doctype html>';
const start = appSource.indexOf(startMarker);
const end = appSource.indexOf('</html>`;', start);

if (start < 0 || end < 0) {
  throw new Error('Unable to extract the Web Monitor document from app.js');
}

const documentTemplate = appSource
  .slice(start + 'return `'.length, end + '</html>'.length)
  .replaceAll('${faviconMime}', 'image/x-icon')
  .replaceAll('${faviconSrc}', '/SiR_SM_Circle.ico')
  .replaceAll('${headerLogoSrc}', '/SiR_SM_Source_sq.png')
  .replaceAll('${embeddedToken}', '');

const fixtureGroups = {
  fps: [
    { id: 'fps', name: 'Frame Rate', value: 144, units: 'FPS', formatted: '144 FPS', summary: { min: 118, max: 165, count: 20 } },
    { id: 'frame-time', name: 'Frame Time', value: 6.94, units: 'ms', formatted: '6.94 ms', summary: { min: 6.1, max: 8.4, count: 20 } }
  ],
  cpu: [
    { id: 'cpu-load', name: 'CPU Total Load', value: 32.4, units: '%', formatted: '32.4 %', summary: { min: 11.2, max: 62.8, count: 20 } },
    { id: 'cpu-temp', name: 'CPU Package', value: 61.2, units: '°C', formatted: '61.2 °C', summary: { min: 48.1, max: 72.4, count: 20 } }
  ],
  gpu: [
    { id: 'gpu-load', name: 'GPU Core Load', value: 74.8, units: '%', formatted: '74.8 %', summary: { min: 20.1, max: 91.3, count: 20 } },
    { id: 'gpu-temp', name: 'GPU Core', value: 67.3, units: '°C', formatted: '67.3 °C', summary: { min: 45.4, max: 73.8, count: 20 } }
  ],
  ram: [
    { id: 'ram-used', name: 'Memory Used', value: 18.6, units: 'GB', formatted: '18.60 GB', summary: { min: 16.4, max: 20.2, count: 20 } },
    { id: 'ram-load', name: 'Memory Load', value: 58.2, units: '%', formatted: '58.2 %', summary: { min: 51.2, max: 63.1, count: 20 } }
  ],
  psu: [],
  fans: [],
  network: [
    { id: 'download', name: 'Ethernet Download Rate', value: 11.2, units: 'MB/s', formatted: '11.20 MB/s', summary: { min: 0.2, max: 28.4, count: 20 } },
    { id: 'uploaded', name: 'Ethernet Data Uploaded', value: 2.4, units: 'GB', formatted: '2.40 GB', summary: { min: 1.8, max: 2.4, count: 20 } }
  ],
  latency: [],
  drives: [],
  app: [
    { id: 'app_cpu_usage', name: 'SiR CPU Usage', value: 1.8, units: '%', formatted: '2 %', summary: { min: 0.4, max: 4.6, count: 20 } },
    { id: 'app_memory_usage', name: 'SiR Memory Usage', value: 286.4, units: 'MB', formatted: '286.40 MB', summary: { min: 272.1, max: 301.8, count: 20 } },
    { id: 'app_uptime', name: 'SiR App Uptime', value: 42.3, units: 'min', formatted: '42.3 min', summary: { min: 0, max: 42.3, count: 20 } },
    { id: 'app_sensor_read_duration', name: 'Last Sensor Read Duration', value: 24.18, units: 'ms', formatted: '24.18 ms', summary: { min: 18.4, max: 42.7, count: 20 } }
  ],
  other: []
};

const palette = {
  bgPrimary: '#101311',
  bgSecondary: '#181d1a',
  bgTertiary: '#252c28',
  textPrimary: '#f1f5f2',
  textSecondary: '#a8b2ab',
  sensorLabel: '#f1f5f2',
  sensorValue: '#24ef82',
  iconColor: '#24ef82',
  graphColor: '#24ef82',
  blockHeaderColor: '#24ef82',
  borderColor: '#356347',
  accent: '#00b84f',
  accentLight: '#24ef82'
};

function sendFile(response, fileName, contentType) {
  response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' });
  response.end(fs.readFileSync(path.join(root, fileName)));
}

const port = Math.max(1024, Number(process.argv[2]) || 18765);
const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || '/', `http://127.0.0.1:${port}`);
  if (requestUrl.pathname === '/SiR_SM_Circle.ico') return sendFile(response, 'SiR_SM_Circle.ico', 'image/x-icon');
  if (requestUrl.pathname === '/SiR_SM_Source_sq.png') return sendFile(response, 'SiR_SM_Source_sq.png', 'image/png');
  if (requestUrl.pathname === '/styles.css') return sendFile(response, 'styles.css', 'text/css; charset=utf-8');

  if (requestUrl.pathname === '/themed-dialog') {
    const kind = requestUrl.searchParams.get('kind') === 'profile' ? 'profile' : 'support';
    const dialogPreview = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
      .replace('<script src="app.js"></script>', `<style>
        body { display: block; overflow: hidden; }
        body > .sidebar, body > .sidebar-resize-handle, body > .container, #setupGuideModal, #diagnosticsModal, #updateAvailableModal, #enhancedSensorsConfirmModal, #importSettingsModal { display: none !important; }
      </style><script>
        document.addEventListener('DOMContentLoaded', () => {
          document.body.className = 'theme-orange';
          document.body.style.setProperty('--settings-panel-color', '#2b2723');
          document.body.style.setProperty('--settings-panel-accent-color', '#ff7a00');
          document.body.style.setProperty('--settings-panel-icon-color', '#ffa033');
          const kind = ${JSON.stringify(kind)};
          const modal = document.getElementById('themedDialogModal');
          const dialog = modal.querySelector('.themed-dialog');
          const title = document.getElementById('themedDialogTitleText');
          const icon = document.getElementById('themedDialogIcon');
          const message = document.getElementById('themedDialogMessage');
          const detail = document.getElementById('themedDialogDetail');
          const cancel = document.getElementById('themedDialogCancelBtn');
          const confirm = document.getElementById('themedDialogConfirmBtn');
          modal.classList.remove('is-hidden');
          modal.setAttribute('aria-hidden', 'false');
          if (kind === 'profile') {
            dialog.classList.add('is-success');
            title.textContent = 'Profile Saved';
            icon.className = 'bi bi-check-circle-fill themed-dialog-icon';
            message.textContent = 'Profile "Main" was saved successfully.';
            detail.hidden = true;
            cancel.hidden = true;
            confirm.textContent = 'Done';
          } else {
            dialog.classList.add('is-warning');
            title.textContent = 'Create Support Bundle?';
            icon.className = 'bi bi-file-earmark-zip-fill themed-dialog-icon';
            message.textContent = 'SiR System Monitor will automatically run all six read-only diagnostic checks before creating the support bundle. The checks run one at a time and can take about a minute, or longer on slower systems.';
            detail.hidden = false;
            detail.innerHTML = '<i class="bi bi-activity" aria-hidden="true"></i><span>The current results box will be cleared. Each test result—including failures or timeouts—will be added to the privacy-scrubbed ZIP. You can cancel while a check is running.</span>';
            cancel.hidden = false;
            confirm.textContent = 'Run 6 Tests & Continue';
          }
        });
      </script>`);
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return response.end(dialogPreview);
  }

  if (requestUrl.pathname === '/diagnostics') {
    const diagnosticsPreview = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
      .replace('<script src="app.js"></script>', `<style>
        body { display: block; overflow: hidden; }
        body > .sidebar, body > .sidebar-resize-handle, body > .container, #setupGuideModal, #updateAvailableModal, #enhancedSensorsConfirmModal, #importSettingsModal { display: none !important; }
      </style><script>
        document.addEventListener('DOMContentLoaded', () => {
          document.body.className = 'theme-orange';
          const modal = document.getElementById('diagnosticsModal');
          modal.classList.remove('is-hidden');
          modal.setAttribute('aria-hidden', 'false');
          const output = document.getElementById('diagnosticsOutput');
          const status = document.getElementById('diagnosticsStatus');
          document.querySelectorAll('[data-diagnostic-id]').forEach((button) => button.addEventListener('click', () => {
            output.value = 'SiR System Monitor - Diagnostic Report\\nVersion: 1.3.5\\n\\n[Application]\\nMemory (Task Manager private working set): 121.7 MB\\nPrivate commit: 286.4 MB\\nWorking set (includes shared pages): 447.2 MB\\nAggregate CPU usage: 1.82%\\n\\n[Result]\\nDiagnostic completed successfully.';
            status.textContent = button.querySelector('strong').textContent + ' completed.';
            button.blur();
          }));
        });
      </script>`);
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return response.end(diagnosticsPreview);
  }

  if (requestUrl.pathname === '/desktop-controls') {
    const supportedThemes = ['blue', 'purple', 'green', 'red', 'cyan', 'orange'];
    const requestedTheme = String(requestUrl.searchParams.get('theme') || 'blue').toLowerCase();
    const theme = supportedThemes.includes(requestedTheme) ? requestedTheme : 'blue';
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return response.end(`<!doctype html><html><head><link rel="stylesheet" href="/styles.css"></head><body class="theme-${theme}"><main class="container"><header class="header"><div class="header-actions"><button class="header-control-btn web-monitor-toggle-btn enabled running"><span>Web: 127.0.0.1:17381</span></button><button class="header-control-btn discord-toggle-btn enabled connected"><span>Discord: On</span></button><button class="header-control-btn overlay-toggle-btn enabled"><span>Overlay: On</span></button></div></header></main></body></html>`);
  }

  if (requestUrl.pathname === '/api/monitor') {
    let requestedLayout = 'balanced';
    let requestedSummaryLayout = 'compact';
    let requestedMotionSpeed = 'standard';
    let requestedMotionIntensity = 'balanced';
    try {
      const referer = new URL(request.headers.referer || `http://127.0.0.1:${port}/`);
      requestedLayout = normalizeLayoutPreset(referer.searchParams.get('layout'));
      requestedSummaryLayout = normalizeLayoutPreset(referer.searchParams.get('summaryLayout') || 'compact');
      requestedMotionSpeed = ['calm', 'standard', 'lively'].includes(referer.searchParams.get('motionSpeed')) ? referer.searchParams.get('motionSpeed') : 'standard';
      requestedMotionIntensity = ['gentle', 'balanced', 'expressive'].includes(referer.searchParams.get('motionIntensity')) ? referer.searchParams.get('motionIntensity') : 'balanced';
    } catch (error) {}

    const payload = {
      app: 'SiR System Monitor',
      version: '1.3.5',
      updatedAt: Date.now(),
      mode: 'builtin',
      groups: fixtureGroups,
      settings: {
        theme: 'green',
        fontSize: 'medium',
        fontFamily: 'segoe',
        valueMonospace: true,
        fontBold: false,
        disableGlow: false,
        animations: {
          enabled: true,
          settingsDropdowns: true,
          dialogs: true,
          viewTransitions: true,
          sensorIcons: true,
          settingsIcons: true,
          speed: requestedMotionSpeed,
          intensity: requestedMotionIntensity
        },
        temperatureUnit: 'celsius',
        summaryMode: false,
        viewMode: 'standard',
        layoutPreset: requestedLayout,
        layoutConfig: getLayoutPreset(requestedLayout),
        summaryLayoutPreset: requestedSummaryLayout,
        summaryLayoutConfig: getLayoutPreset(requestedSummaryLayout),
        groupOrder: ['fps', 'cpu', 'gpu', 'ram', 'network', 'app'],
        summaryGroupOrder: ['network', 'gpu', 'cpu', 'fps', 'ram', 'app'],
        groupLayout: requestedLayout === 'custom'
          ? {
              fps: { width: 460, height: 240 },
              cpu: { width: 460, height: 520 },
              gpu: { width: 460, height: 260 },
              ram: { width: 340, height: 320 },
              network: { width: 560, height: 360 }
            }
          : {},
        summaryGroupLayout: requestedSummaryLayout === 'custom'
          ? {
              fps: { width: 300, height: 300 },
              cpu: { width: 620, height: 380 },
              gpu: { width: 420, height: 440 },
              ram: { width: 300, height: 300 },
              network: { width: 520, height: 340 }
            }
          : {},
        palette
      }
    };
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return response.end(JSON.stringify(payload));
  }

  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(documentTemplate);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Web layout fixture listening on http://127.0.0.1:${port}/?layout=balanced`);
});
