'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  PROCESS_QUERY_LIMITED_INFORMATION,
  normalizeProcessIds,
  sampleWindowsPrivateWorkingSets
} = require('../windowsProcessMemory');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert.deepStrictEqual(normalizeProcessIds([42, '42', 7, 0, -1, 'bad']), [42, 7], 'Process IDs should be normalized and deduplicated.');

const closedHandles = [];
const fakeMemoryByPid = new Map([[42, 80 * 1024 * 1024], [7, 24 * 1024 * 1024]]);
const fakeApi = {
  structSize: 112,
  openProcess(access, inherit, pid) {
    assert.strictEqual(access, PROCESS_QUERY_LIMITED_INFORMATION, 'Memory sampling should request limited query access only.');
    assert.strictEqual(inherit, false, 'Memory sampling handles must not be inherited.');
    return fakeMemoryByPid.has(pid) ? { pid } : null;
  },
  getProcessMemoryInfo(handle, counters, size) {
    assert.strictEqual(size, this.structSize, 'The full EX2 structure size should be passed to Windows.');
    counters.PrivateWorkingSetSize = fakeMemoryByPid.get(handle.pid);
    return true;
  },
  closeHandle(handle) {
    closedHandles.push(handle.pid);
    return true;
  }
};

const memorySample = sampleWindowsPrivateWorkingSets([42, 7], fakeApi);
assert.strictEqual(memorySample.supported, true, 'A successful Windows sample should be marked supported.');
assert.strictEqual(memorySample.totalBytes, 104 * 1024 * 1024, 'Private working sets should be aggregated across the Electron process group.');
assert.deepStrictEqual(closedHandles, [42, 7], 'Every process handle should be closed.');

const mainWindowSource = mainSource.slice(mainSource.indexOf('function createWindow()'), mainSource.indexOf('function createOverlayWindow()'));
const overlayWindowSource = mainSource.slice(mainSource.indexOf('function createOverlayWindow()'), mainSource.indexOf("ipcMain.on('overlay:update'"));
assert(mainWindowSource.includes('backgroundThrottling: false'), 'The monitoring renderer must remain scheduled while Windows powers off the display.');
assert(overlayWindowSource.includes('backgroundThrottling: true'), 'The passive overlay renderer should retain normal Chromium background throttling.');
assert(mainWindowSource.includes('fan-control leases must continue'), 'The display-sleep fan-control scheduling reason should remain documented beside the window setting.');
assert(mainSource.includes("setAlwaysOnTop(true, 'screen-saver')"), 'Overlay should use a reliable foreground topmost level.');
assert(mainSource.includes('setOverlayBoundsIfChanged'), 'Overlay bounds updates should be idempotent.');
assert((mainSource.match(/setAlwaysOnTop\(true, 'screen-saver'\)/g) || []).length === 1, 'Overlay topmost elevation must have one controlled implementation.');
assert(mainSource.includes("overlayWindow.once('ready-to-show', applyOverlayCompatibility)"), 'Overlay should confirm its z-order after the native window is ready.');
assert(mainSource.includes("process.env.SIR_DISABLE_GPU_ACCELERATION === '1'"), 'Hardware acceleration should be enabled by default with an explicit troubleshooting opt-out.');
assert(!mainSource.includes("const enableGpuAcceleration = process.env.SIR_ENABLE_GPU_ACCELERATION === '1';"), 'Hardware acceleration must no longer require an opt-in environment variable.');
assert(mainSource.includes('readEarlyGpuAccelerationPreference()'), 'The saved GPU-acceleration compatibility setting must be read before Chromium starts.');
assert((mainSource.match(/disableGpuAcceleration:/g) || []).length >= 2, 'The main-process behavior defaults and normalizer must persist the acceleration preference.');
assert((appSource.match(/disableGpuAcceleration:/g) || []).length >= 3, 'The renderer must normalize, display, and save the acceleration preference.');
assert(mainSource.includes("ipcMain.handle('performance:get-status'"), 'The Performance section should report current acceleration and cache state.');
assert(mainSource.includes("ipcMain.handle('performance:clear-cache'"), 'The Performance section should expose the safe cache-clear action.');
assert(mainSource.includes('await activeSession.clearCache()'), 'Cache clearing should remove Chromium HTTP cache data.');
assert(mainSource.includes('await activeSession.clearCodeCaches({})'), 'Cache clearing should also remove regenerable compiled-code cache data.');
assert(htmlSource.includes('data-section-key="app_behavior_performance"'), 'App Behavior should contain a dedicated Performance section.');
assert(htmlSource.includes('id="disableGpuAcceleration"'), 'Performance settings should include the acceleration compatibility checkbox.');
assert(htmlSource.includes('id="clearAppCacheBtn"'), 'Performance settings should include the cache-clear button.');
assert(appSource.includes("disableGpuAcceleration: 'Disable Chromium GPU acceleration"), 'The acceleration setting should have an explanatory tooltip.');
assert(appSource.includes("clearAppCacheBtn: 'Clear regenerable Chromium"), 'The cache action should have an explanatory tooltip.');
assert(mainSource.includes('APP_RUNTIME_SAMPLE_INTERVAL_MS = 1000'), 'Expensive process metrics should be cached between fast refresh ticks.');
assert(mainSource.includes("mainWindow.webContents.send('monitoring:tick'"), 'The main process must keep the sensor refresh clock alive while the renderer is background throttled.');
assert(mainSource.includes("ipcMain.handle('monitoring:set-refresh-interval'"), 'The selected refresh interval must be synchronized to the main-process monitoring clock.');
assert(appSource.includes('if (document.hidden)'), 'Dashboard painting should defer only while the window is actually hidden.');
assert(appSource.includes('const shouldUpdateDesktopUi = !isDocumentHidden;'), 'Visible sensor/status values must keep updating when another app has focus.');
assert(!appSource.includes('if (isDocumentHidden && !webMonitorActive)'), 'Minimizing the app must not stop sensor collection, alerts, or OSD updates.');
assert(appSource.includes("ipcRenderer.on('monitoring:tick'"), 'The renderer must process main-process monitoring ticks while minimized.');
assert(appSource.includes("ipcRenderer.invoke('monitoring:set-refresh-interval', updateInterval)"), 'Refresh-rate changes must reconfigure the background-safe monitoring clock.');
const updateStatsSource = appSource.slice(
  appSource.indexOf('async function updateStats('),
  appSource.indexOf('function scheduleNextUpdateTick(')
);
assert(updateStatsSource.includes('sendOverlayPayload(getOverlaySensorPayload(selected));'), 'The background sensor cycle must continue forwarding live values to the OSD.');
assert(updateStatsSource.indexOf('sensorReader.getEnhancedData') < updateStatsSource.indexOf('sendOverlayPayload(getOverlaySensorPayload(selected));'), 'The OSD must be refreshed from the latest completed sensor read.');
assert(appSource.includes("document.body.classList.toggle('app-inactive', !active)"), 'Desktop and web animation activity state should be synchronized.');
assert((appSource.match(/const active = !document\.hidden;/g) || []).length >= 2, 'Desktop and web animations should pause only when their document is hidden.');
assert(appSource.includes('function updateDynamicGroupValuesInPlace'), 'Ordinary sensor rows should update in place instead of being rebuilt.');
assert(appSource.includes('function updateSensorSummaryInPlace'), 'Summary statistics should update without reconstructing sensor rows.');
assert(appSource.includes('pendingDynamicGroupRenderFrame = requestAnimationFrame(flushDynamicGroupRender)'), 'Desktop sensor DOM writes should be batched into one animation frame.');
assert(appSource.includes('function queueExpandedGraphRender'), 'Expanded desktop graphs should have an isolated render pass.');
assert(appSource.includes('function queueWebGraphRender'), 'Expanded web graphs should have an isolated render pass.');
assert(appSource.includes('function queueWebRender'), 'Web Monitor DOM writes should be batched into one animation frame.');
const groupSignatureSource = appSource.slice(
  appSource.indexOf('function buildGroupRenderSignature('),
  appSource.indexOf('function prepareSelectedSensorsForRender(')
);
assert(!groupSignatureSource.includes('normalizedValue'), 'Live numeric values must not invalidate sensor-row structure.');
assert(!groupSignatureSource.includes('alertSeverity'), 'Alert changes should update classes in place instead of rebuilding rows.');
assert(appSource.includes('if (loading || document.hidden) return;'), 'Hidden Web Monitor tabs should skip polling work.');
assert(appSource.includes('new IntersectionObserver'), 'Off-screen animated icons should be visibility tracked.');
assert(appSource.includes('function runAmbientIconMotionCycle'), 'Desktop ambient icon motion should use one shared staggered scheduler.');
assert(cssSource.includes('.group-icon.ambient-icon-motion'), 'Sensor icons should animate only during a scheduled ambient pulse or direct hover.');
assert(!cssSource.includes('animation: sensor-card-icon-live var(--motion-icon-duration) ease-in-out infinite'), 'Sensor and settings icons must not keep independent perpetual animation timelines.');
assert(cssSource.includes('body.app-inactive *::before'), 'Background pseudo-element animations should be paused.');
assert(cssSource.includes('contain: layout style'), 'Sensor cards should contain layout recalculation.');
const sensorHoverSource = cssSource.slice(
  cssSource.indexOf('.sensor-group:hover'),
  cssSource.indexOf('body:not(.no-sensor-icon-animations)', cssSource.indexOf('.sensor-group:hover'))
);
assert(!/background|border|box-shadow/.test(sensorHoverSource), 'Sensor-card hover feedback should use compositor-friendly properties only.');
assert(sensorHoverSource.includes('transform:'), 'Sensor-card hover feedback should remain visible through a transform.');

console.log('Performance regression checks passed.');
