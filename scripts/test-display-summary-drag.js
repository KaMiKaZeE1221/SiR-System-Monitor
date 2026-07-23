'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

function loadStandaloneFunction(name) {
  const match = appSource.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?^\\}`, 'm'));
  assert(match, `${name} could not be extracted for behavior testing`);
  return vm.runInNewContext(`(${match[0]})`);
}

['light', 'dark', 'system'].forEach((mode) => {
  assert(
    htmlSource.includes(`data-display-mode="${mode}"`),
    `${mode} appearance mode is missing`
  );
});
[
  'summarySessionControls',
  'resetSummaryStatsBtn'
].forEach((id) => assert(htmlSource.includes(`id="${id}"`), `${id} is missing`));
assert(!htmlSource.includes('id="summarySessionStartedAt"'), 'The removed Summary session-start label is still present');
assert(!appSource.includes('Session began'), 'Summary Mode still renders the removed session-start text');

const snapshotStart = appSource.indexOf('const SETTINGS_SNAPSHOT_KEYS = [');
const snapshotEnd = appSource.indexOf('];', snapshotStart);
const snapshotSource = appSource.slice(snapshotStart, snapshotEnd);
assert(snapshotSource.includes('DISPLAY_MODE_KEY'), 'Display mode is not included in profiles/exports');
assert(snapshotSource.includes('CUSTOM_COLOR_PALETTES_KEY'), 'Light and dark custom palettes are not included in profiles/exports');
assert(appSource.includes("window.matchMedia('(prefers-color-scheme: light)')"), 'Follow Windows does not observe the Windows app-mode preference');
assert(appSource.includes('dark: this.normalizeColors') && appSource.includes('light: this.normalizeColors'), 'Custom colors are not independently retained for both modes');
assert(cssSource.includes('.monitoring-mode-btn.active') && cssSource.includes('color: #08111f;'), 'The active Summary Mode button does not use high-contrast dark text');

const summarizeSensorSessionStats = loadStandaloneFunction('summarizeSensorSessionStats');
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(summarizeSensorSessionStats({ min: 10, max: 30, sum: 60, count: 3 }))),
  { min: 10, average: 20, max: 30, count: 3 }
);
assert.strictEqual(summarizeSensorSessionStats({ min: 1, max: 1, sum: 0, count: 0 }), null);
assert(appSource.includes('<span class="summary-metric-label">Avg</span>'), 'Desktop Summary Mode does not render Average');
assert(appSource.includes('<span class="summary-label">Avg</span>'), 'Web Summary Mode does not render Average');
assert(appSource.includes("'/api/session/reset'"), 'Web Summary Mode cannot reset session statistics');

const reorderCardIdsForDrop = loadStandaloneFunction('reorderCardIdsForDrop');
assert.deepStrictEqual(
  Array.from(reorderCardIdsForDrop(['cpu', 'hidden', 'gpu', 'ram'], 'ram', 'cpu', true)),
  ['ram', 'cpu', 'hidden', 'gpu']
);
assert.deepStrictEqual(
  Array.from(reorderCardIdsForDrop(['cpu', 'gpu', 'ram'], 'cpu', 'ram', false)),
  ['gpu', 'ram', 'cpu']
);

const dragStart = appSource.indexOf('function setupWindowDragAndDrop()');
const dragEnd = appSource.indexOf('\nfunction applyFontSize', dragStart);
const dragSource = appSource.slice(dragStart, dragEnd);
assert(dragSource.includes("container.addEventListener('pointerdown'"), 'Card dragging does not use pointer-based input');
assert(dragSource.includes('getBoundingClientRect()'), 'Card dragging does not calculate visual grid positions');
assert(dragSource.includes('window.requestAnimationFrame(runAutoScroll)'), 'Card dragging does not provide stable edge auto-scroll');
assert(dragSource.includes('card-drop-marker'), 'Card dragging does not show an exact placement preview');
assert(!dragSource.includes("addEventListener('dragstart'"), 'Unreliable native HTML card dragging is still active');
assert(appSource.includes('function setupStackedDashboardWheelScroll()'), 'Stacked dashboard wheel routing is missing');
assert(appSource.includes("document.body.classList.contains('layout-stacked')"), 'Wheel routing is not limited to Stacked layout');
assert(appSource.includes("eventTarget.closest('.sensor-group')"), 'Stacked wheel routing does not work while hovering sensor cards');
assert(appSource.includes('container.scrollTop += delta;'), 'Stacked wheel input is not applied to the dashboard scroller');

console.log('Display modes, Summary Mode statistics, and card dragging checks passed.');
