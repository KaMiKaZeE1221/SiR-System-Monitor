'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.resolve(__dirname, '..', 'app.js'), 'utf8');

assert(
  appSource.includes('name: getFinalDisplayLabel(sensor),'),
  'The Web Monitor payload does not use the current custom sensor label.'
);
assert(
  appSource.includes("publishWebMonitorPayload(latestWebPayload.mode || 'builtin', latestWebPayload.external || 'N/A');"),
  'Renaming a sensor does not immediately republish the Web Monitor payload.'
);
assert(
  appSource.includes('data-reset-sensor-name-id=') &&
    appSource.includes('function resetCustomSensorName(sensorId)') &&
    appSource.includes('resetCustomSensorName(resetNameButton.dataset.resetSensorNameId);'),
  'Per-sensor custom-name reset controls are missing or do not refresh the live payload.'
);

console.log('Live Web Monitor custom-name synchronization checks passed.');
