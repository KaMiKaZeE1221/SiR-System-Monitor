const assert = require('assert');
const fs = require('fs');
const path = require('path');

const mainSource = fs.readFileSync(path.resolve(__dirname, '..', 'main.js'), 'utf8');

assert(
  mainSource.includes("mainWindow.webContents.once('dom-ready'"),
  'The main window is not revealed at DOM readiness.'
);
assert(
  !mainSource.includes("mainWindow.once('ready-to-show'"),
  'The main window still waits for the late ready-to-show event.'
);
assert(
  mainSource.includes('startupRevealHandled = true') && mainSource.includes('startupWindowOpenedByUser = true'),
  'Manual window opening does not cancel pending startup visibility behavior.'
);
assert(
  mainSource.includes('clearTimeout(startupRevealTimer)'),
  'Pending startup-delay/minimize actions are not cancelled.'
);

console.log('Window startup visibility tests passed.');
