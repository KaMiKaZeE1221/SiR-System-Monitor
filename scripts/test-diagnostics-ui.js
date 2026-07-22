'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  DIAGNOSTIC_TESTS,
  getDiagnosticDefinition,
  listPublicDiagnostics
} = require('../diagnosticsCatalog');

const root = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

const ids = DIAGNOSTIC_TESTS.map((test) => test.id);
assert.strictEqual(new Set(ids).size, ids.length, 'Diagnostic IDs must be unique.');
assert.strictEqual(DIAGNOSTIC_TESTS.length, 6, 'The end-user diagnostics page should contain the curated six checks.');
assert.strictEqual(listPublicDiagnostics().length, DIAGNOSTIC_TESTS.length, 'Every allowlisted diagnostic should be exposed to the UI.');
assert.strictEqual(getDiagnosticDefinition('SENSOR-CHECK').id, 'sensor-check', 'Diagnostic lookup should be normalized and allowlisted.');
assert.strictEqual(getDiagnosticDefinition('../main.js'), null, 'Arbitrary script paths must never resolve as diagnostics.');

const allowedScripts = new Set([
  'test-sensor-host.js',
  'test-sensor-startup-timing.js',
  'test-sensor-host-recovery.js',
  'benchmark-sensor-host.js'
]);
DIAGNOSTIC_TESTS.filter((test) => test.kind === 'script').forEach((test) => {
  assert(allowedScripts.has(test.script), `${test.id} uses a script not approved for end-user diagnostics.`);
  assert(fs.existsSync(path.join(root, 'scripts', test.script)), `${test.script} is missing.`);
  assert(Number(test.timeoutMs) >= 10_000 && Number(test.timeoutMs) <= 30_000, `${test.id} has an unsafe timeout.`);
  assert(Array.isArray(test.args), `${test.id} arguments must be fixed in the allowlist.`);
});

assert(mainSource.includes("ipcMain.handle('diagnostics:run'"), 'Main process diagnostic runner IPC is missing.');
assert(mainSource.includes("ipcMain.handle('diagnostics:cancel'"), 'Diagnostic cancellation IPC is missing.');
assert(mainSource.includes("ELECTRON_RUN_AS_NODE: '1'"), 'Bundled scripts must run through the packaged Electron Node runtime.');
assert(mainSource.includes('DIAGNOSTIC_OUTPUT_LIMIT_BYTES'), 'Diagnostic output must be bounded.');
assert(mainSource.includes('getDiagnosticDefinition(diagnosticId)'), 'Diagnostic execution must resolve through the strict allowlist.');
assert(!mainSource.includes("path.join(app.getAppPath(), 'scripts', diagnosticId"), 'User-controlled diagnostic IDs must not become script paths.');

assert(html.includes('id="diagnosticsHeaderBtn"'), 'The dashboard header needs a Diagnostics button.');
assert(html.includes('id="diagnosticsModal"'), 'The Diagnostics page is missing.');
assert(html.includes('id="diagnosticsOutput"') && html.includes('readonly'), 'Diagnostic output must be a selectable, read-only text area.');
assert(html.includes('id="diagnosticsCopyBtn"'), 'Copy Results is missing.');
assert(html.includes('id="diagnosticsCancelBtn"'), 'Cancel Running Check is missing.');
ids.forEach((id) => assert(html.includes(`data-diagnostic-id="${id}"`), `${id} has no clickable diagnostics button.`));
assert(css.includes('.diagnostics-output') && css.includes('resize: vertical'), 'Diagnostic results must be user-resizable.');
assert(appSource.includes("ipcRenderer.on('diagnostics:output'"), 'The UI must stream diagnostic output.');
assert(appSource.includes("ipcRenderer.on('diagnostics:complete'"), 'The UI must handle diagnostic completion.');
assert(appSource.includes("navigator.clipboard.writeText(text)"), 'Diagnostic results must be copyable.');

console.log('Diagnostics allowlist, runner, and UI checks passed.');
