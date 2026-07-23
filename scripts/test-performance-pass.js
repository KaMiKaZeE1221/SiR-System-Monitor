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

assert(!mainSource.includes('backgroundThrottling: false'), 'Electron background throttling must not be disabled.');
assert((mainSource.match(/backgroundThrottling: true/g) || []).length >= 2, 'Main and overlay windows should permit Chromium background throttling.');
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
assert(appSource.includes('function updateDynamicGroupValuesInPlace'), 'Ordinary sensor rows should update in place instead of being rebuilt.');
assert(appSource.includes('if (loading || document.hidden) return;'), 'Hidden Web Monitor tabs should skip polling work.');
assert(appSource.includes('new IntersectionObserver'), 'Off-screen animated icons should be visibility tracked.');
assert(appSource.includes('function runAmbientIconMotionCycle'), 'Desktop ambient icon motion should use one shared staggered scheduler.');
assert(cssSource.includes('.group-icon.ambient-icon-motion'), 'Sensor icons should animate only during a scheduled ambient pulse or direct hover.');
assert(!cssSource.includes('animation: sensor-card-icon-live var(--motion-icon-duration) ease-in-out infinite'), 'Sensor and settings icons must not keep independent perpetual animation timelines.');
assert(cssSource.includes('body.app-inactive *::before'), 'Background pseudo-element animations should be paused.');
assert(cssSource.includes('contain: layout style'), 'Sensor cards should contain layout recalculation.');

console.log('V1.3.5 performance regression checks passed.');
