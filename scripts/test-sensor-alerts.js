const assert = require('assert');
const { listEnabledAlertSensors } = require('../sensorAlerts');

const grouped = {
  cpu: [{ id: 'cpu_temp', name: 'CPU Temp' }, { id: 'cpu_clock', name: 'CPU Clock' }],
  gpu: [{ id: 'gpu_temp', name: 'GPU Temp' }],
  ram: [{ id: 'ram_usage', name: 'RAM Usage' }]
};

const enabled = listEnabledAlertSensors(
  grouped,
  ['cpu', 'gpu', 'ram'],
  { cpu_temp: true, cpu_clock: false, gpu_temp: true, ram_usage: true },
  { cpu: true, gpu: false, ram: true }
);

assert.deepStrictEqual(
  enabled.map((entry) => entry.sensor.id),
  ['cpu_temp', 'ram_usage'],
  'Alert choices must exclude disabled sensors and disabled categories.'
);
assert.deepStrictEqual(listEnabledAlertSensors(null, ['cpu'], {}, {}), [], 'Missing catalogs should be safe.');

console.log('Sensor alert filtering tests passed.');
