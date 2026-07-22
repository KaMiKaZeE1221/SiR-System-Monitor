const assert = require('assert');
const SensorReader = require('../sensorReader');

const enhanced = process.argv.includes('--enhanced');
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main() {
  const reader = new SensorReader();
  const providers = {
    builtin: true,
    enhanced,
    rtss: false,
    aida64: false,
    hwinfo: false
  };

  try {
    const firstStartedAt = Date.now();
    const first = await reader.getEnhancedData('builtin', { providers });
    const firstSnapshotMs = Date.now() - firstStartedAt;
    assert(first && first.external, 'Initial built-in snapshot returned no data.');
    assert(firstSnapshotMs < 3000, `Initial built-in snapshot was too slow (${firstSnapshotMs} ms).`);
    await wait(1100);
    const second = await reader.getEnhancedData('builtin', { providers });
    const data = second && second.external;

    assert(data, 'Built-in provider returned no data.');
    assert(data.groupedSensors, 'Built-in provider returned no grouped sensor catalog.');
    assert(data.groupedSensors.cpu.length > 0, 'CPU sensors are missing.');
    assert(data.groupedSensors.ram.length > 0, 'RAM sensors are missing.');
    assert(data.groupedSensors.drives.length > 0, 'Drive sensors are missing.');
    assert(data.groupedSensors.network.length > 0, 'Network sensors are missing.');

    const sensors = Object.values(data.groupedSensors).flat();
    const ids = sensors.map((sensor) => sensor.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'Sensor IDs are not unique.');
    assert(sensors.every((sensor) => typeof sensor.defaultEnabled === 'boolean'), 'A sensor is missing its default selection state.');
    assert(Number(data.diagnostics.workingSetBytes) > 0, 'Sensor host working-set diagnostics are missing.');
    assert.strictEqual(Number(data.diagnostics.directPsuDeviceIdsSupported), 19, 'The native PSU USB ID catalog is incomplete.');
    assert.strictEqual(Number(data.diagnostics.directPsuProtocolsSupported), 3, 'The native PSU protocol catalog is incomplete.');
    assert(Array.isArray(data.diagnostics.enhancedHardwareFamilies) && data.diagnostics.enhancedHardwareFamilies.length >= 10, 'Common enhanced-hardware coverage is not reported.');
    assert(ids.includes('builtin_os_network_lan_ip'), 'LAN IP sensor is missing.');
    assert(ids.includes('builtin_os_network_wan_ip'), 'WAN IP sensor is missing.');
    assert(ids.includes('builtin_os_memory_read_rate'), 'Memory read-speed sensor is missing.');
    assert(ids.includes('builtin_os_memory_write_rate'), 'Memory write-speed sensor is missing.');
    assert(ids.includes('builtin_os_cpu_clock_speed'), 'Overall CPU clock-speed sensor is missing.');
    assert(ids.includes('builtin_presentmon_fps'), 'Vendor-neutral native FPS sensor is missing.');
    assert(ids.includes('builtin_presentmon_frametime'), 'Vendor-neutral native frame-time sensor is missing.');
    assert.strictEqual(typeof data.diagnostics.nativeFpsAvailable, 'boolean', 'Native FPS availability diagnostics are missing.');
    assert.strictEqual(typeof data.diagnostics.nativeFpsRunning, 'boolean', 'Native FPS runtime diagnostics are missing.');
    assert.strictEqual(typeof data.diagnostics.nativeFpsGpuVendor, 'string', 'Native FPS GPU-vendor diagnostics are missing.');
    assert(['displayed frames', 'presented frames'].includes(data.diagnostics.nativeFpsCaptureMethod), 'Native FPS capture-method diagnostics are invalid.');
    assert(Number.isFinite(Number(data.diagnostics.nativeFpsRecoveredTraceSessions)), 'Native FPS trace-session recovery diagnostics are missing.');
    const cpuClock = sensors.find((sensor) => sensor.id === 'builtin_os_cpu_clock_speed');
    assert.strictEqual(cpuClock.units, 'MHz', 'Overall CPU clock-speed units are incorrect.');
    assert(Number(cpuClock.value) > 0, 'Overall CPU clock-speed value is unavailable.');
    const memoryRates = sensors.filter((sensor) => sensor.id === 'builtin_os_memory_read_rate' || sensor.id === 'builtin_os_memory_write_rate');
    assert(memoryRates.every((sensor) => sensor.units === 'B/s'), 'Memory activity rates must originate as bytes per second.');
    const nativeFps = sensors.find((sensor) => sensor.id === 'builtin_presentmon_fps');
    const nativeFrameTime = sensors.find((sensor) => sensor.id === 'builtin_presentmon_frametime');
    assert.strictEqual(nativeFps.units, 'FPS', 'Native FPS units are incorrect.');
    assert.strictEqual(nativeFrameTime.units, 'ms', 'Native frame-time units are incorrect.');
    assert.strictEqual(nativeFps.defaultEnabled, true, 'Native FPS should be selected by default.');
    assert.strictEqual(nativeFrameTime.defaultEnabled, true, 'Native frame time should be selected by default.');
    const thermaltakePsuSensors = sensors.filter((sensor) => sensor.id.startsWith('builtin_thermaltake_psu_'));
    if (thermaltakePsuSensors.length > 0) {
      const expectedThermaltakeUnits = {
        builtin_thermaltake_psu_ac_input_voltage: 'V',
        builtin_thermaltake_psu_12v_voltage: 'V',
        builtin_thermaltake_psu_12v_current: 'A',
        builtin_thermaltake_psu_12v_power: 'W',
        builtin_thermaltake_psu_5v_voltage: 'V',
        builtin_thermaltake_psu_5v_current: 'A',
        builtin_thermaltake_psu_5v_power: 'W',
        builtin_thermaltake_psu_3v3_voltage: 'V',
        builtin_thermaltake_psu_3v3_current: 'A',
        builtin_thermaltake_psu_3v3_power: 'W',
        builtin_thermaltake_psu_output_power: 'W',
        builtin_thermaltake_psu_temperature: 'C',
        builtin_thermaltake_psu_fan: 'RPM'
      };
      assert.strictEqual(thermaltakePsuSensors.length, Object.keys(expectedThermaltakeUnits).length, 'The Thermaltake PSU sensor set is incomplete.');
      Object.entries(expectedThermaltakeUnits).forEach(([id, units]) => {
        const sensor = thermaltakePsuSensors.find((candidate) => candidate.id === id);
        assert(sensor, `Thermaltake PSU sensor ${id} is missing.`);
        assert.strictEqual(sensor.group, 'psu', `${id} was assigned to the wrong category.`);
        assert.strictEqual(sensor.units, units, `${id} has incorrect units.`);
        assert(Number.isFinite(Number(sensor.value)), `${id} has no numeric value.`);
        assert.strictEqual(sensor.defaultEnabled, true, `${id} should be selected by default.`);
      });
    }
    const digitalPsuFamilies = [
      { prefix: 'builtin_corsair_psu_', expectedCount: 15 },
      { prefix: 'builtin_nzxt_e_psu_', expectedCount: 18 }
    ];
    digitalPsuFamilies.forEach(({ prefix, expectedCount }) => {
      const familySensors = sensors.filter((sensor) => sensor.id.startsWith(prefix));
      if (familySensors.length === 0) return;
      assert.strictEqual(familySensors.length, expectedCount, `${prefix} returned an incomplete telemetry set.`);
      familySensors.forEach((sensor) => {
        assert.strictEqual(sensor.group, 'psu', `${sensor.id} was assigned to the wrong category.`);
        assert(['V', 'A', 'W', 'C', 'RPM'].includes(sensor.units), `${sensor.id} has invalid PSU units.`);
        assert(Number.isFinite(Number(sensor.value)), `${sensor.id} has no numeric value.`);
        assert.strictEqual(sensor.defaultEnabled, true, `${sensor.id} should be selected by default.`);
      });
    });
    if (enhanced) {
      assert.strictEqual(data.diagnostics.enhancedRequested, true, 'Enhanced mode was not requested.');
      assert(data.diagnostics.enhancedSensorCount >= 0, 'Enhanced diagnostics are missing.');
      assert.strictEqual(typeof data.diagnostics.enhancedCoreAvailable, 'boolean', 'Core discovery diagnostics are missing.');
      assert.strictEqual(typeof data.diagnostics.enhancedCoreInitializing, 'boolean', 'Core initialization diagnostics are missing.');
      assert.strictEqual(typeof data.diagnostics.enhancedPeripheralAvailable, 'boolean', 'Peripheral discovery diagnostics are missing.');
      assert.strictEqual(typeof data.diagnostics.enhancedPeripheralInitializing, 'boolean', 'Peripheral initialization diagnostics are missing.');
      assert.strictEqual(typeof data.diagnostics.enhancedProcessorAvailable, 'boolean', 'Processor discovery diagnostics are missing.');
      assert.strictEqual(typeof data.diagnostics.enhancedGraphicsAvailable, 'boolean', 'Graphics discovery diagnostics are missing.');
      assert.strictEqual(typeof data.diagnostics.enhancedBoardAvailable, 'boolean', 'Motherboard discovery diagnostics are missing.');
      const expectedUnitsByType = { Clock: 'MHz', Voltage: 'V', Load: '%', Temperature: 'C', Power: 'W' };
      (data.groupedSensors.gpu || []).forEach((sensor) => {
        if (expectedUnitsByType[sensor.sensorType]) {
          assert.strictEqual(sensor.units, expectedUnitsByType[sensor.sensorType], `${sensor.name} has an unstable unit.`);
        }
      });
      const gpuClock = (data.groupedSensors.gpu || []).find((sensor) => sensor.sensorType === 'Clock');
      const gpuVoltage = (data.groupedSensors.gpu || []).find((sensor) => sensor.sensorType === 'Voltage');
      if (gpuClock) assert(/clock|frequency/i.test(gpuClock.name), 'GPU clock label is ambiguous.');
      if (gpuVoltage) assert(/voltage|volt/i.test(gpuVoltage.name), 'GPU voltage label is ambiguous.');
    }

    const summary = {
      source: data.source,
      sensors: sensors.length,
      defaultEnabled: sensors.filter((sensor) => sensor.defaultEnabled).length,
      groups: Object.fromEntries(Object.entries(data.groupedSensors).map(([group, list]) => [group, list.length])),
      workingSetMb: Math.round((Number(data.diagnostics.workingSetBytes) / 1024 / 1024) * 10) / 10,
      enhancedAvailable: data.diagnostics.enhancedAvailable === true,
      warning: data.diagnostics.warning || null,
      firstSnapshotMs
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    reader.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
