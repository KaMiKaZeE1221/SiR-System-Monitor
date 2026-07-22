'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const SensorReader = require('../sensorReader');

const root = path.resolve(__dirname, '..');
const hostSource = fs.readFileSync(path.join(root, 'sensor-host', 'Program.cs'), 'utf8');
const buildSource = fs.readFileSync(path.join(root, 'scripts', 'build-sensor-host.ps1'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert(
  buildSource.includes('PawnIO_setup.exe') &&
    buildSource.includes('A3A46226C5E2824F4CDD42BE0EECBABFC672C86F7889710F5AB1E6AD385B47A0'),
  'The pinned PawnIO installer is not hash-verified by the sensor-host build.'
);
assert(
  hostSource.includes('hardwareAccessDriverInstalled') &&
    hostSource.includes('cpuPackagePowerAvailable') &&
    hostSource.includes('unavailableCpuPowerDomains'),
  'Hardware-access and CPU package-power diagnostics are missing.'
);
assert(
  hostSource.includes('_validatedCpuPowerSensorIds') &&
    hostSource.includes('else if (!_validatedCpuPowerSensorIds.Contains(powerSensorId))') &&
    hostSource.includes('(hardware.Name ?? "").IndexOf("Intel", StringComparison.OrdinalIgnoreCase) >= 0'),
  'Unsupported zero-valued Intel RAPL power domains are still being published as real sensors.'
);
assert(
  hostSource.includes('group == "cpu" && lowerType == "power" && lowerName.Contains("package")'),
  'CPU package power is not selected by default.'
);
assert(
  mainSource.includes("const INSTALL_HARDWARE_ACCESS_DRIVER_ARGUMENT = '--sir-install-hardware-access-driver';") &&
    mainSource.includes("ipcMain.handle('hardware-access:get-status'") &&
    mainSource.includes("['-install']"),
  'The elevated, consent-driven hardware-access driver installation flow is incomplete.'
);
assert(
  appSource.includes('installHardwareAccessDriver: true') &&
    htmlSource.includes('bundled PawnIO hardware-access driver') &&
    htmlSource.includes('Intel CPU package power'),
  'Enhanced Hardware Sensors does not explain or request the Intel power dependency.'
);

const reader = new SensorReader();
try {
  const data = reader.createBuiltinProviderData({
    timestamp: Date.now(),
    diagnostics: { enhancedAvailable: true, hardwareAccessDriverInstalled: true },
    sensors: [
      {
        id: 'builtin_lhm_intel_cpu_package_temperature',
        name: 'Intel Core i7 CPU Package Temperature',
        value: 55,
        units: 'C',
        group: 'cpu',
        provider: 'builtin',
        hardwareType: 'Cpu',
        sensorType: 'Temperature',
        defaultEnabled: true
      },
      {
        id: 'builtin_lhm_intel_cpu_package_power',
        name: 'Intel Core i7 CPU Package Power',
        value: 47.25,
        units: 'W',
        group: 'cpu',
        provider: 'builtin',
        hardwareType: 'Cpu',
        sensorType: 'Power',
        defaultEnabled: true
      },
      {
        id: 'builtin_lhm_intel_cpu_cores_power',
        name: 'Intel Core i7 CPU Cores Power',
        value: 31.5,
        units: 'W',
        group: 'cpu',
        provider: 'builtin',
        hardwareType: 'Cpu',
        sensorType: 'Power',
        defaultEnabled: false
      }
    ]
  });

  assert.strictEqual(data.cpuPower, 47.25, 'Intel CPU Package Power was not selected by sensor type and package role.');
  assert.strictEqual(data.groupedSensors.cpu.filter((sensor) => sensor.sensorType === 'Power').length, 2, 'Intel power-domain sensors were lost.');
} finally {
  reader.close();
}

console.log('Intel CPU power compatibility tests passed.');
