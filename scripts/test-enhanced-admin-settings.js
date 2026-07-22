const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const rendererSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert(
  rendererSource.includes("enableLaunchAsAdministrator: true"),
  'Enhanced sensor elevation does not request persistent administrator launches.'
);
assert(
  rendererSource.includes("providerSelection.enhanced === true && settings.launchAsAdministrator !== true"),
  'Existing enhanced-sensor settings are not migrated to administrator startup.'
);
assert(
  rendererSource.includes('normalizeEnhancedAdministratorSnapshot(profile.snapshot)'),
  'Legacy profiles can still disable administrator launch while enhanced sensors are enabled.'
);
assert(
  mainSource.includes("saveBehaviorSettings({ ...appBehaviorSettings, launchAsAdministrator: true })"),
  'The main process does not persist administrator startup before elevation.'
);
assert(
  mainSource.includes('saveBehaviorSettings(previousBehaviorSettings)'),
  'Cancelled elevation does not restore the prior administrator setting.'
);
assert(
  htmlSource.includes('also enable Launch app as administrator'),
  'The enhanced-sensor confirmation does not explain the startup setting change.'
);

console.log('Enhanced sensor administrator-setting tests passed.');
