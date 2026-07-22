'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const readerSource = fs.readFileSync(path.join(root, 'sensor-host', 'PresentMonFpsReader.cs'), 'utf8');
const hostSource = fs.readFileSync(path.join(root, 'sensor-host', 'Program.cs'), 'utf8');
const buildSource = fs.readFileSync(path.join(root, 'scripts', 'build-sensor-host.ps1'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const expectedHash = 'D74183E7AE630F72CD3690BE0373ECBFDC6CBB86578148AAB8FA2A7166068F34';

assert(
  buildSource.includes('PresentMon-2.4.1-x64.exe') && buildSource.includes(expectedHash),
  'The official PresentMon binary is not pinned and hash-verified.'
);
assert(
  readerSource.includes('--v1_metrics') &&
    readerSource.includes('--no_track_gpu --no_track_input') &&
    readerSource.includes('DetectGpuAdapters()') &&
    readerSource.includes('MsBetweenDisplayChange') &&
    readerSource.includes('MsBetweenPresents') &&
    readerSource.includes('CleanupOrphanedTraceSessions') &&
    readerSource.includes('--stop_existing_session') &&
    readerSource.includes('GetForegroundProcessId()') &&
    readerSource.includes('_lastActiveProcessId') &&
    readerSource.includes('TrimSamples(swapChain, newestQpcMilliseconds - SampleRetentionMilliseconds)') &&
    !readerSource.includes('Stopwatch.GetTimestamp()'),
  'The GPU-aware, recoverable foreground-process FPS selection path is incomplete.'
);
assert(
  hostSource.includes('builtin_presentmon_fps') &&
    hostSource.includes('builtin_presentmon_frametime') &&
    hostSource.includes('nativeFpsRunning') &&
    hostSource.includes('nativeFpsGpuVendor') &&
    hostSource.includes('nativeFpsCaptureMethod') &&
    hostSource.includes('nativeFpsRecoveredTraceSessions'),
  'Native FPS sensors or GPU-aware diagnostics are missing from the native host.'
);
assert(
  htmlSource.includes('id="nativeFpsStatus"') &&
    htmlSource.includes('data-section-key="monitoring_sensor_sources"') &&
    !htmlSource.includes('<div class="settings-group-title">Data Sources</div>') &&
    appSource.includes('Native FPS active'),
  'Native FPS runtime status is not exposed under Monitoring > Sensor Sources.'
);

const executablePath = path.join(root, 'sensor-host', 'bin', 'PresentMon.exe');
if (fs.existsSync(executablePath)) {
  const actualHash = crypto.createHash('sha256').update(fs.readFileSync(executablePath)).digest('hex').toUpperCase();
  assert.strictEqual(actualHash, expectedHash, 'The built PresentMon payload hash is incorrect.');
}

console.log('Vendor-neutral native FPS support checks passed.');
