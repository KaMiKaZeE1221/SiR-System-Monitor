'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.resolve(__dirname, '..', 'app.js'), 'utf8');

assert(
  appSource.includes("webEnabled.addEventListener('change', () => {") &&
    appSource.includes('applyWebSettings();'),
  'Enable Browser View does not immediately apply the requested service state.'
);
assert(
  appSource.includes('const nextEnabled = !webMonitorDesiredEnabled;'),
  'The header Web control still toggles a stale checkbox instead of the requested runtime state.'
);
assert(
  appSource.includes('webMonitorLifecycleQueue = webMonitorLifecycleQueue') &&
    appSource.includes('queueWebMonitorRuntimeState(nextSettings)'),
  'Web Monitor start/stop transitions are not serialized.'
);
assert(
  !appSource.includes('webEnabledCheckbox.checked = !webEnabledCheckbox.checked;'),
  'The obsolete checkbox-inversion Web Monitor toggle is still present.'
);

console.log('Web Monitor state synchronization tests passed.');
