const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  summarizeElectronAppMetrics,
  buildAppTelemetrySensors
} = require('../appTelemetry');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

const runtime = summarizeElectronAppMetrics([
  {
    type: 'Browser',
    cpu: { percentCPUUsage: 2.5 },
    memory: { workingSetSize: 1024, peakWorkingSetSize: 2048, privateBytes: 800 }
  },
  {
    type: 'Tab',
    cpu: { percentCPUUsage: 1.25 },
    memory: { workingSetSize: 2048, peakWorkingSetSize: 4096, privateBytes: 1600 }
  },
  {
    type: 'Utility',
    cpu: { percentCPUUsage: 0.25 },
    memory: { workingSetSize: 512, peakWorkingSetSize: 1024, privateBytes: 400 }
  }
], {
  windowCount: 2,
  visibleWindowCount: 1,
  uptimeSeconds: 123.5
});

assert.strictEqual(runtime.cpuPercent, 4, 'Process CPU usage should be aggregated.');
assert.strictEqual(runtime.workingSetBytes, 3584 * 1024, 'Working-set memory should convert from KB to bytes.');
assert.strictEqual(runtime.peakWorkingSetBytes, 7168 * 1024, 'Peak memory should convert from KB to bytes.');
assert.strictEqual(runtime.privateBytes, 2800 * 1024, 'Private memory should convert from KB to bytes.');
assert.strictEqual(runtime.processCount, 3, 'Process count should include every Electron process.');
assert.strictEqual(runtime.rendererProcessCount, 1, 'Renderer processes should be classified.');
assert.strictEqual(runtime.utilityProcessCount, 1, 'Utility processes should be classified.');
assert.strictEqual(runtime.windowCount, 2, 'Window count should be retained.');
assert.strictEqual(runtime.visibleWindowCount, 1, 'Visible window count should be retained.');

const sensors = buildAppTelemetrySensors(runtime, {
  refreshIntervalMs: 1000,
  sensorReadDurationMs: 28.5,
  updateCycleDurationMs: 34.75,
  detectedSensorCount: 142,
  enabledSensorCount: 24,
  activeAlertCount: 2,
  webConnectionCount: 1
});
const byId = new Map(sensors.map((sensor) => [sensor.id, sensor]));

assert.strictEqual(byId.size, sensors.length, 'App telemetry sensor IDs must be unique.');
assert(sensors.length >= 16, 'The App group should expose a useful diagnostic sensor set.');
assert(sensors.every((sensor) => sensor.group === 'app'), 'Every app telemetry sensor should use the App group.');
assert(sensors.every((sensor) => sensor.provider === 'sir-app'), 'Every app telemetry sensor should identify its source.');
assert(Math.abs(byId.get('app_memory_usage').value - (2800 / 1024)) < 0.0001, 'Primary app memory should use private bytes to match Windows Task Manager.');
assert.strictEqual(byId.get('app_working_set_memory').value, 3.5, 'Detailed working-set memory should remain available separately.');
assert.strictEqual(byId.get('app_sensor_read_duration').value, 28.5, 'Sensor read timing should be exposed.');
assert.strictEqual(byId.get('app_detected_sensor_count').value, 142, 'Detected sensor count should be exposed.');
assert.strictEqual(byId.get('app_active_alert_count').value, 2, 'Active alert count should be exposed.');
assert.strictEqual(byId.get('app_working_set_memory').defaultEnabled, false, 'Detailed diagnostics should remain opt-in.');
assert.strictEqual(byId.get('app_cpu_usage').defaultEnabled, true, 'Core app CPU telemetry should be enabled by default.');

assert(appSource.includes("'showApp'"), 'App visibility must be part of profile snapshots.');
assert(appSource.includes("app: 'appGroup'"), 'App telemetry must participate in card ordering and layout.');
assert(appSource.includes("app: 'showApp'"), 'App telemetry must participate in visibility filtering and Web Monitor.');
assert(appSource.includes("renderDynamicGroup('appSensorsDynamic', selected.app)"), 'App telemetry must render through the standard sensor renderer.');
assert(appSource.includes("buildAppTelemetrySensors(runtimeStats"), 'The renderer must add live app telemetry to the shared catalogue.');
assert(appSource.includes("'drives', 'app', 'other'"), 'App telemetry must be included in desktop and Web group order.');
assert(mainSource.includes("ipcMain.handle('app:get-runtime-stats'"), 'The main process must expose lightweight Electron runtime metrics.');
assert(mainSource.includes('app.getAppMetrics()'), 'Runtime telemetry must use Electron in-process metrics.');
assert(html.includes('id="showApp"'), 'Visible Sensors must include an App checkbox.');
assert(html.includes('id="appGroup"'), 'The dashboard must include an App sensor card.');
assert(html.includes('id="appSensorsDynamic"'), 'The App card must use a standard dynamic sensor container.');
assert(html.includes('id="overlayLineLimit_app"'), 'The overlay must include an App line limit.');
assert(css.includes('#appSensorsDynamic'), 'The App dynamic container must share sensor scrolling styles.');

console.log(`App telemetry tests passed (${sensors.length} sensors).`);
