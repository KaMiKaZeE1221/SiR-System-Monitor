const assert = require('assert');
const {
  SENSOR_DETECTING_VALUE,
  createSensorCatalogCachePayload,
  parseSensorCatalogCache,
  mergeLiveAndCachedCatalog
} = require('../sensorCatalogCache');

const order = ['cpu', 'gpu'];
const payload = createSensorCatalogCachePayload({
  cpu: [{ id: 'cpu_temp', name: 'CPU Temp', value: 55, units: 'C', group: 'cpu' }],
  gpu: [{ id: 'gpu_clock', name: 'GPU Clock', value: 2200, units: 'MHz', group: 'gpu' }]
}, order, 1000);

const restored = parseSensorCatalogCache(payload, order, 2000);
assert(restored, 'A current cache should restore.');
assert.strictEqual(restored.cpu[0].value, SENSOR_DETECTING_VALUE, 'Cached readings must not be presented as live values.');
assert.strictEqual(parseSensorCatalogCache(payload, order, 31 * 24 * 60 * 60 * 1000), null, 'Expired caches must be rejected.');

const merged = mergeLiveAndCachedCatalog({
  cpu: [{ id: 'cpu_temp', name: 'CPU Temp', value: 60, units: 'C', group: 'cpu' }],
  gpu: []
}, restored, order);
assert.strictEqual(merged.cpu.length, 1, 'Live sensors must not be duplicated by the cache.');
assert.strictEqual(merged.cpu[0].value, 60, 'Live readings must win over placeholders.');
assert.strictEqual(merged.gpu[0].value, SENSOR_DETECTING_VALUE, 'Missing sensors should remain visible as detecting during discovery.');

console.log('Sensor catalog cache tests passed.');
