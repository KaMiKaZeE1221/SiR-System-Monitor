const assert = require('assert');
const {
  classifyNetworkSensor,
  resolveNetworkDisplayUnits,
  scaleBinaryNetworkValue
} = require('../networkUnits');

assert.deepStrictEqual(
  scaleBinaryNetworkValue(11613.75, 'B/s', 'rate'),
  { value: 11613.75 / 1024, units: 'KB/s' }
);
assert.deepStrictEqual(
  scaleBinaryNetworkValue(1024, 'KB/s', 'rate'),
  { value: 1, units: 'MB/s' }
);
assert.deepStrictEqual(
  scaleBinaryNetworkValue(5 * 1024 * 1024, 'B/s', 'rate'),
  { value: 5, units: 'MB/s' }
);
assert.deepStrictEqual(
  scaleBinaryNetworkValue(1024, 'MB', 'total'),
  { value: 1, units: 'GB' }
);
assert.deepStrictEqual(
  scaleBinaryNetworkValue(1023.99, 'MB', 'total'),
  { value: 1023.99, units: 'MB' }
);

const uploaded = {
  name: 'Ethernet 2 Data Uploaded',
  sensorType: 'Data',
  units: '%'
};
assert.strictEqual(classifyNetworkSensor(uploaded), 'total');
assert.strictEqual(resolveNetworkDisplayUnits(uploaded, '%'), 'GB');

const downloadedSmall = {
  name: 'Ethernet 2 Data Downloaded',
  sensorType: 'SmallData',
  units: '%'
};
assert.strictEqual(resolveNetworkDisplayUnits(downloadedSmall, '%'), 'MB');

const rate = {
  name: 'Ethernet 2 Download Rate',
  sensorType: 'Throughput',
  units: 'B/s'
};
assert.strictEqual(classifyNetworkSensor(rate), 'rate');
assert.strictEqual(resolveNetworkDisplayUnits(rate, 'B/s'), 'B/s');

const utilization = {
  name: 'Ethernet 2 Network Utilization',
  sensorType: 'Load',
  units: '%'
};
assert.strictEqual(resolveNetworkDisplayUnits(utilization, '%'), '%');

console.log('Network unit formatting tests passed.');
