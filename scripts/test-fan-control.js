'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_FAN_CURVE,
  normalizeFanChannel,
  normalizeFanCurve,
  normalizeFanControlSettings,
  interpolateFanCurve,
  combineTemperatureValues
} = require('../fanControl');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const readerSource = fs.readFileSync(path.join(root, 'sensorReader.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const hostSource = fs.readFileSync(path.join(root, 'sensor-host', 'Program.cs'), 'utf8');
const amdAdlxSource = fs.readFileSync(path.join(root, 'sensor-host', 'AmdAdlxFanController.cs'), 'utf8');
const hostBuildSource = fs.readFileSync(path.join(root, 'scripts', 'build-sensor-host.ps1'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

const normalized = normalizeFanControlSettings({
  enabled: true,
  curveStudioCollapsed: true,
  channels: {
    fan_1: {
      mode: 'curve',
      displayName: '  Rear radiator  ',
      collapsed: true,
      hidden: true,
      offsetPercent: 75,
      primarySensorId: 'cpu_temp',
      secondarySensorId: 'gpu_temp',
      sensorMode: 'average',
      minimumPercent: 10,
      emergencyTemperature: 200,
      curvePoints: [{ temperature: 80, percent: 90 }, { temperature: 40, percent: 30 }]
    },
    fan_2: { mode: 'global' }
  },
  globalCurve: {
    primarySensorId: 'cpu_temp',
    secondarySensorId: 'gpu_temp',
    sensorMode: 'average',
    curvePoints: [{ temperature: 35, percent: 32 }, { temperature: 82, percent: 100 }]
  }
});

assert.strictEqual(normalized.enabled, true);
assert.strictEqual(normalized.curveStudioCollapsed, true);
assert.strictEqual(normalized.channels.fan_1.sensorMode, 'average');
assert.strictEqual(normalized.channels.fan_1.displayName, 'Rear radiator');
assert.strictEqual(normalized.channels.fan_1.collapsed, true);
assert.strictEqual(normalized.channels.fan_1.hidden, true);
assert.strictEqual(normalized.channels.fan_1.offsetPercent, 50, 'Per-fan output offset must be safely bounded.');
assert.strictEqual(normalized.channels.fan_2.mode, 'global');
assert.strictEqual(normalized.channels.fan_1.minimumPercent, 20, 'Absolute minimum fan level must be clamped to 20%.');
assert.strictEqual(normalized.channels.fan_1.emergencyTemperature, 110, 'Emergency temperature must be bounded.');
assert.deepStrictEqual(normalized.channels.fan_1.curvePoints.map((point) => point.temperature), [40, 80]);
assert.strictEqual(normalized.globalCurve.sensorMode, 'average');
assert.deepStrictEqual(normalized.globalCurve.curvePoints.map((point) => point.temperature), [35, 82]);
assert.deepStrictEqual(Object.keys(normalizeFanCurve({})), ['primarySensorId', 'secondarySensorId', 'sensorMode', 'minimumPercent', 'hysteresis', 'emergencyTemperature', 'curvePoints']);
assert.strictEqual(interpolateFanCurve(DEFAULT_FAN_CURVE, 60), 57.5);
assert.strictEqual(combineTemperatureValues(60, 80, 'average'), 70);
assert.strictEqual(combineTemperatureValues(60, null, 'average'), null);
assert.strictEqual(combineTemperatureValues(60, undefined, 'average'), null);

const manual = normalizeFanChannel({ mode: 'manual', manualPercent: 5 });
assert.strictEqual(manual.manualPercent, 20);

assert(html.includes('id="fanControlEnabled"'), 'Fan Control master toggle is missing.');
assert(html.includes('id="fanControlChannels"'), 'Fan Control channel editor is missing.');
assert(html.includes('id="fanControlViewBtn"'), 'Dedicated Fan Control header button is missing.');
assert(html.includes('id="fanControlView"'), 'Dedicated Fan Control workspace is missing.');
assert(!html.includes('data-section-key="monitoring_fan_control"'), 'Fan Control should not remain inside the Settings pane.');
const statsContainerIndex = html.indexOf('id="statsContainer"');
const fanControlViewIndex = html.indexOf('id="fanControlView"');
const setupGuideModalIndex = html.indexOf('id="setupGuideModal"');
const diagnosticsModalIndex = html.indexOf('id="diagnosticsModal"');
assert(fanControlViewIndex > statsContainerIndex, 'Fan Control workspace must follow the dashboard grid.');
assert(fanControlViewIndex < setupGuideModalIndex, 'Fan Control workspace must remain inside the main dashboard container.');
assert(fanControlViewIndex < diagnosticsModalIndex, 'Fan Control workspace must not be nested inside the hidden Diagnostics modal.');
assert(appSource.includes('Average two temperature sensors'), 'Two-sensor average UI is missing.');
assert(appSource.includes('function applyFanControlView('), 'Dedicated Fan Control view switching is missing.');
assert(appSource.includes('const requestedEnabled = enabledToggle.checked === true;'), 'Fan Control must capture the requested toggle state before awaiting confirmation.');
assert(appSource.includes('fanControlEnableRequestPending'), 'Fan Control confirmation must be protected from sensor-refresh rerenders.');
assert(appSource.includes('function scheduleFanControlRuntimeApply('), 'Fan Control edits must schedule an immediate native-host refresh.');
assert(appSource.includes('fan-controls-board'), 'Fan Control must render a dedicated controls board.');
assert(!appSource.includes('fan-temperatures-board'), 'The redundant Temperature Sources board must remain removed.');
assert(appSource.includes('fan-curves-board'), 'Fan Control must render a separate Curve Studio.');
assert(appSource.includes('Global Curve · all assigned fans'), 'Global curve editor is missing.');
assert(appSource.includes("mode: 'global'"), 'Global curve assignment is missing.');
assert(appSource.includes('displayName'), 'Fan renaming is missing.');
assert(appSource.includes('data-fan-action="reset-name"'), 'Per-fan name reset is missing.');
assert(appSource.includes('data-fan-action="toggle-collapse"'), 'Per-fan card minimization is missing.');
assert(appSource.includes('data-fan-action="hide-card"'), 'Per-fan card visibility control is missing.');
assert(appSource.includes('data-fan-action="show-hidden"'), 'Hidden fan cards need a recovery action.');
assert(appSource.includes('data-fan-action="toggle-curve-studio"'), 'Curve Studio minimization is missing.');
assert(appSource.includes('data-fan-field="offsetPercent"'), 'Per-fan percentage offsets are missing.');
assert(appSource.includes('data-fan-action="add-point"'), 'Dynamic curve-point creation is missing.');
assert(appSource.includes('data-fan-action="remove-point"'), 'Dynamic curve-point removal is missing.');
assert(appSource.includes('data-fan-action="reset-curve"'), 'Curve reset is missing.');
assert(appSource.includes('fanCurveDragState ||'), 'Telemetry rerenders must be suspended while a curve point is grabbed.');
assert(appSource.includes("channel.mode === 'global'"), 'Global curves must be flattened into host-compatible curve channels.');
assert(appSource.includes('data-fan-curve-node'), 'Curve Studio must expose draggable graph points.');
assert(appSource.includes("container.addEventListener('pointermove'"), 'Curve graph drag handling is missing.');
assert(styles.includes('.fan-curve-studio'), 'Curve Studio layout styling is missing.');
assert(styles.includes('.fan-control-meter-row'), 'Compact fan telemetry card styling is missing.');
assert(/\.stats-container\[hidden\][\s\S]*?display:\s*none\s*!important/.test(styles), 'The dashboard grid must be forcibly hidden while Fan Control is open.');
assert(/\.fan-control-workspace\[hidden\][\s\S]*?display:\s*none\s*!important/.test(styles), 'The Fan Control workspace hidden state must override its layout styles.');
assert(appSource.includes("const FAN_CONTROL_SETTINGS_KEY = 'fanControlSettingsV1';"), 'Fan Control persistence key is missing.');
assert(appSource.includes('FAN_CONTROL_SETTINGS_KEY,'), 'Fan Control settings are not included in profiles/exports.');
assert(readerSource.includes("command: 'snapshot'"), 'Sensor host snapshot protocol is missing.');
assert(readerSource.includes('fanControl: this.fanControlConfiguration'), 'Fan Control configuration is not sent to the sensor host.');
assert(readerSource.includes("command: 'shutdown'"), 'Closing the sensor client must explicitly request native fan restoration.');
assert(readerSource.includes('options.graceful !== false'), 'Sensor-host shutdown must prefer the acknowledged graceful path.');
assert(readerSource.includes('if (exitTimer) clearTimeout(exitTimer)'), 'A successful host exit must cancel the forced-shutdown timer.');
assert(appSource.includes("ipcRenderer.on('app:prepare-shutdown'"), 'The renderer must handle the main-process shutdown handshake.');
assert(appSource.includes('await prepareSensorCollectorForShutdown()'), 'The renderer must await sensor-host restoration before acknowledging shutdown.');
assert(mainSource.includes('function prepareRendererForShutdown()'), 'The main process is missing its renderer shutdown handshake.');
assert(mainSource.includes("ipcMain.on('app:shutdown-ready'"), 'The main process must wait for the renderer restoration acknowledgement.');
assert(mainSource.includes('requestGracefulQuit();'), 'Window and tray exits must use the graceful fan-restoration path.');
assert(mainSource.includes('if (!rendererShutdownPrepared) event.preventDefault();'), 'Repeated close attempts must not bypass fan restoration.');
assert(hostSource.includes('controlSensor.Control.SetSoftware'), 'Writable LibreHardwareMonitor controls are not used.');
assert(hostSource.includes('controlSensor.Control.SetDefault'), 'BIOS/default restoration is missing.');
assert(hostSource.includes('app heartbeat expired'), 'Fan Control heartbeat safety fallback is missing.');
assert(hostSource.includes('selected temperature sensor is unavailable'), 'Missing-temperature failsafe is missing.');
assert(hostSource.includes('fan RPM remained below 100'), 'Fan-stall failsafe is missing.');
assert(hostSource.includes('IsProtectedFanControl'), 'Pump/AIO protection is missing.');
assert(hostSource.includes('offsetPercent = Clamp(input.offsetPercent, -50, 50)'), 'Native fan offsets must be bounded.');
assert(hostSource.includes('if (channel.mode == "curve" && !immediateSafetyResponse)'), 'Curve offsets must not reduce emergency failsafe output.');
assert(hostSource.includes('requestedPercent += channel.offsetPercent'), 'Native curve evaluation must apply each fan offset.');
assert(hostSource.includes('_lastFanControlOffsetPercent'), 'Offset changes must remain responsive inside the curve hysteresis band.');
assert(hostSource.includes('backend = backend'), 'Fan-control capabilities must identify their native backend.');
assert(hostSource.includes('status += " · AMD ADLX"'), 'AMD controls must use the modern ADLX write path.');
assert(hostSource.includes('_amdAdlxFanControl.TryReset'), 'AMD controls must return to automatic mode through ADLX.');
assert(hostSource.includes('RestoreFanControlsForShutdown'), 'The native shutdown command must restore all claimed fan channels before acknowledgement.');
assert(amdAdlxSource.includes('TryResetAll'), 'AMD shutdown must reset every claimed ADLX channel, even if sensor enumeration changes.');
assert(amdAdlxSource.includes('ADLXCSharpBind.dll'), 'The AMD controller must validate its native ADLX binding.');
assert(amdAdlxSource.includes('SetFanTuningStates2'), 'AMD RDNA fan curves must be applied through ADLX tuning states.');
assert(amdAdlxSource.includes('Invoke(binding.FanTuning, "Reset")'), 'AMD automatic-mode restoration is missing.');
assert(hostBuildSource.includes('2bb7729a935b7acc600dfce3a5b6340b6bddb9b1'), 'The open ADLX integration must be pinned to an audited commit.');
assert(hostBuildSource.includes('CE742DA3C57A68896D300A45F040906A68990B7B09C5B82FF3883CAF2C155644'), 'ADLXWrapper.dll integrity pin is missing.');
assert(hostBuildSource.includes('B7C39D1EB3E665826BA7121A3D74F952C8519C6AEE877EDF194E47AE625BC7CF'), 'ADLXCSharpBind.dll integrity pin is missing.');
assert(styles.includes('.fan-control-tile.is-collapsed'), 'Collapsed fan-card styling is missing.');
assert(styles.includes('.fan-curves-board.is-collapsed'), 'Collapsed Curve Studio styling is missing.');
assert(/\.fan-control-grid\s*\{[\s\S]*?align-items:\s*start/.test(styles), 'Collapsed fan cards must not stretch to the height of an expanded neighbour.');

console.log('Fan control configuration, UI, protocol, and safety checks passed.');
