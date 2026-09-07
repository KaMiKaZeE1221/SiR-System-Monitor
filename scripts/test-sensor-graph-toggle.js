'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const functionStart = appSource.indexOf('function updateDynamicGroupValuesInPlace(');
const functionEnd = appSource.indexOf('\nfunction renderDynamicGroup(', functionStart);
assert(functionStart >= 0 && functionEnd > functionStart, 'Could not locate the in-place sensor renderer.');

const functionSource = appSource.slice(functionStart, functionEnd);
const sandbox = {
  module: { exports: null },
  summaryModeEnabled: false,
  expandedGraphSensors: new Set(),
  activeSensorAlertState: {},
  getFinalDisplayLabel: (sensor) => sensor.name,
  formatSensorValue: (sensor) => `${sensor.value} ${sensor.units}`
};
vm.createContext(sandbox);
vm.runInContext(`${functionSource}\nmodule.exports = updateDynamicGroupValuesInPlace;`, sandbox);
const updateDynamicGroupValuesInPlace = sandbox.module.exports;

function createClassList(names = []) {
  const values = new Set(names);
  return {
    contains(name) { return values.has(name); },
    toggle(name, enabled) {
      if (enabled) values.add(name);
      else values.delete(name);
    }
  };
}

function createRow({ expanded = false, graph = false } = {}) {
  const label = { textContent: 'CPU Clock' };
  const value = { textContent: '4000 MHz' };
  return {
    dataset: { sensorId: encodeURIComponent('cpu-clock') },
    classList: createClassList(['stat', ...(expanded ? ['is-expanded'] : [])]),
    querySelector(selector) {
      if (selector === '.stat-label') return label;
      if (selector === '.stat-value') return value;
      if (selector.includes('.stat-graph-wrap') || selector.includes('.stat-graph-empty')) return graph ? {} : null;
      return null;
    },
    label,
    value
  };
}

const sensors = [{ id: 'cpu-clock', name: 'CPU Clock', value: 4050, units: 'MHz' }];
const staleExpandedRow = createRow({ expanded: true, graph: true });
assert.strictEqual(
  updateDynamicGroupValuesInPlace({ children: [staleExpandedRow] }, sensors),
  false,
  'Closing a graph must force a structural rebuild instead of retaining the expanded DOM.'
);

const normalRow = createRow();
assert.strictEqual(updateDynamicGroupValuesInPlace({ children: [normalRow] }, sensors), true);
assert.strictEqual(normalRow.value.textContent, '4050 MHz', 'Ordinary sensor values should still use the low-overhead in-place path.');

console.log('Sensor graph open/close rendering checks passed.');
