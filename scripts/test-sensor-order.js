const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { reorderVisibleSensors } = require('../sensorOrder');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

assert.deepStrictEqual(
  reorderVisibleSensors(['a', 'b', 'c', 'd'], 'd', 'b', false, ['a', 'b', 'c', 'd']),
  ['a', 'd', 'b', 'c']
);

assert.deepStrictEqual(
  reorderVisibleSensors(['a', 'hidden-1', 'b', 'hidden-2', 'c'], 'c', 'a', false, ['a', 'b', 'c']),
  ['c', 'hidden-1', 'a', 'hidden-2', 'b']
);

assert.deepStrictEqual(
  reorderVisibleSensors(['a', 'hidden-1', 'b', 'hidden-2', 'c'], 'a', 'c', true, ['a', 'b', 'c']),
  ['b', 'hidden-1', 'c', 'hidden-2', 'a']
);

assert.deepStrictEqual(
  reorderVisibleSensors(['a', 'b'], 'missing', 'b', false, ['a', 'b']),
  ['a', 'b']
);

assert.ok(htmlSource.includes('id="sensorHideUntickedBtn"'), 'Sensor Selection is missing the Hide Unticked button');
assert.ok(htmlSource.indexOf('id="sensorSearchInput"') < htmlSource.indexOf('id="sensorHideUntickedBtn"'), 'Hide Unticked must appear beside and after search');
assert.ok(appSource.includes("const SENSOR_HIDE_UNTICKED_KEY = 'sensorHideUnticked';"), 'Hide Unticked is not persisted');
assert.ok(appSource.includes('const matches = searchMatches && (!hideUnticked || isTicked);'), 'Hide Unticked is not combined with search filtering');
assert.ok(/saveSensorSelection\(\);\s+refreshSensorAlertEditor\([\s\S]*?\);\s+applySensorSelectionFilter\(\);/.test(appSource), 'Unticking a sensor does not refresh the active filter');
assert.ok(cssSource.includes('.sensor-search-row .sensor-hide-unticked-btn'), 'Hide Unticked button layout styling is missing');

console.log('Sensor order tests passed.');
