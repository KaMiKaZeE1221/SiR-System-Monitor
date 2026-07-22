'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const {
  DEFAULT_LAYOUT_PRESET,
  LAYOUT_PRESET_STORAGE_KEY,
  SUMMARY_LAYOUT_PRESET_STORAGE_KEY,
  SUMMARY_CUSTOM_LAYOUT_CONFIG_STORAGE_KEY,
  SUMMARY_CUSTOM_LAYOUT_SIZES_STORAGE_KEY,
  LAYOUT_PRESETS,
  normalizeLayoutPreset,
  getLayoutPreset
} = require('../layoutPresets');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

assert.strictEqual(DEFAULT_LAYOUT_PRESET, 'balanced');
assert.strictEqual(LAYOUT_PRESET_STORAGE_KEY, 'layoutPreset');
assert.strictEqual(SUMMARY_LAYOUT_PRESET_STORAGE_KEY, 'summaryLayoutPreset');
assert.strictEqual(SUMMARY_CUSTOM_LAYOUT_CONFIG_STORAGE_KEY, 'summaryCustomLayoutConfig');
assert.strictEqual(SUMMARY_CUSTOM_LAYOUT_SIZES_STORAGE_KEY, 'summaryCustomLayoutSizes');
assert.deepStrictEqual(Object.keys(LAYOUT_PRESETS), ['compact', 'balanced', 'wide', 'stacked', 'custom']);
assert.strictEqual(normalizeLayoutPreset('WIDE'), 'wide');
assert.strictEqual(normalizeLayoutPreset('unknown'), DEFAULT_LAYOUT_PRESET);
assert.strictEqual(getLayoutPreset('stacked').stacked, true);

Object.values(LAYOUT_PRESETS).forEach((preset) => {
  assert.ok(preset.minCardWidth >= 180, `${preset.id} card width is too small`);
  assert.ok(preset.cardHeight >= 220, `${preset.id} card height is too small`);
  assert.ok(preset.gap >= 0, `${preset.id} gap must not be negative`);
  assert.ok(htmlSource.includes(`value="${preset.id}"`), `${preset.id} is missing from the Layout dropdown`);
});

const snapshotListStart = appSource.indexOf('const SETTINGS_SNAPSHOT_KEYS = [');
const snapshotListEnd = appSource.indexOf('];', snapshotListStart);
const snapshotList = appSource.slice(snapshotListStart, snapshotListEnd + 2);

[
  'LAYOUT_PRESET_KEY',
  'SENSOR_HIDE_UNTICKED_KEY',
  'WINDOW_ORDER_KEY',
  'SUMMARY_WINDOW_ORDER_KEY',
  'WINDOW_SIZE_KEY',
  'CUSTOM_LAYOUT_CONFIG_KEY',
  'CUSTOM_LAYOUT_SIZES_KEY',
  'SUMMARY_LAYOUT_PRESET_KEY',
  'SUMMARY_CUSTOM_LAYOUT_CONFIG_KEY',
  'SUMMARY_CUSTOM_LAYOUT_SIZES_KEY',
  'SUMMARY_WINDOW_SIZE_KEY',
  'OVERLAY_GROUP_SPACING_KEY',
  'OVERLAY_SCALE_KEY',
  'OVERLAY_MONITOR_KEY',
  'OVERLAY_HOTKEY_KEY',
  'OVERLAY_DRAG_UNLOCK_KEY',
  'OVERLAY_CUSTOM_X_KEY',
  'OVERLAY_CUSTOM_Y_KEY',
  'OVERLAY_CUSTOM_POSITION_ENABLED_KEY'
].forEach((keyName) => {
  assert.ok(snapshotList.includes(keyName), `${keyName} is missing from settings snapshots`);
});

assert.ok(appSource.includes('layoutPreset: selectedLayoutPreset'), 'Web payload is missing the layout preset');
assert.ok(appSource.includes('layoutConfig: selectedLayoutConfig'), 'Web payload is missing the layout configuration');
assert.ok(appSource.includes('summaryLayoutPreset: selectedSummaryLayoutPreset'), 'Web payload is missing the Summary Mode layout preset');
assert.ok(appSource.includes('summaryLayoutConfig: selectedSummaryLayoutConfig'), 'Web payload is missing the Summary Mode layout configuration');
assert.ok(appSource.includes('summaryGroupLayout'), 'Web payload is missing independent Summary Mode card geometry');
assert.ok(appSource.includes('summaryGroupOrder'), 'Web payload is missing the independent Summary Mode card order');
assert.ok(htmlSource.includes('id="summaryLayoutPresetSelect"'), 'The Summary Mode layout selector is missing');
assert.ok(appSource.includes("root.style.setProperty('--layout-card-min-width'"), 'Web Monitor does not apply shared card widths');
assert.ok(cssSource.includes('var(--layout-card-min-width)'), 'Desktop grid does not use the shared card width');
assert.ok(cssSource.includes('var(--layout-card-height)'), 'Desktop cards do not use the shared card height');
assert.ok(cssSource.includes('var(--layout-card-gap)'), 'Desktop grid does not use the shared card gap');
assert.ok(cssSource.includes('body.layout-custom .sensor-resize-handle'), 'Custom layout does not expose card resize handles');
assert.ok(cssSource.includes('grid-template-columns: repeat(36, minmax(0, 1fr))'), 'Custom layout does not provide fine-grained width tracks');
assert.ok(cssSource.includes('grid-auto-rows: 8px') && cssSource.includes('grid-auto-flow: dense'), 'Custom layout does not use masonry-style dense packing');
assert.ok(appSource.includes('const CUSTOM_LAYOUT_COLUMNS = 36;') && appSource.includes('card.style.gridRow = `span ${rowSpan}`'), 'Desktop custom-card width or height spans are incomplete');
assert.ok(appSource.includes('body.layout-custom .grid { grid-template-columns: repeat(36') && appSource.includes("card.style.gridRow = 'span ' + rowSpan"), 'Web Monitor does not mirror the dense custom layout');
assert.ok(cssSource.includes('color-mix(in srgb, var(--accent-light) 76%, white)'), 'Active header controls do not follow the selected theme');
assert.ok(!cssSource.includes('color-mix(in srgb, #6fe6ab 76%, white)'), 'Hard-coded green active controls are still present');

const storage = new Map();
const localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); }
};
const bodyClasses = new Set();
const classList = {
  add(...names) { names.forEach((name) => bodyClasses.add(name)); },
  remove(...names) { names.forEach((name) => bodyClasses.delete(name)); },
  toggle(name, force) {
    const enabled = force === undefined ? !bodyClasses.has(name) : !!force;
    if (enabled) bodyClasses.add(name);
    else bodyClasses.delete(name);
    return enabled;
  },
  contains(name) { return bodyClasses.has(name); }
};
const noop = () => {};
const testDocument = {
  addEventListener: noop,
  querySelectorAll: () => [],
  getElementById: () => null,
  documentElement: { style: { setProperty: noop } },
  body: { classList, style: { setProperty: noop } }
};
const sandbox = {
  module: { exports: {} },
  exports: {},
  require: createRequire(path.join(root, 'app.js')),
  __dirname: root,
  __filename: path.join(root, 'app.js'),
  console,
  process,
  Buffer,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  URL,
  Blob,
  document: testDocument,
  window: { addEventListener: noop, innerWidth: 1600, innerHeight: 900 },
  localStorage,
  getComputedStyle: () => ({ gridTemplateColumns: '300px 300px', columnGap: '14px', gap: '14px' })
};
vm.createContext(sandbox);
vm.runInContext(`${appSource}\nmodule.exports = { applyLayoutPreset, saveWindowSizes, loadWindowSizes, loadCustomLayoutSizes, saveWindowOrder, loadWindowOrder };`, sandbox, { filename: 'app.js' });
const rendererLayout = sandbox.module.exports;
const initialCustomSizes = { cpuGroup: { height: 420, span: 1, width: 340 } };
localStorage.setItem('layoutPreset', 'balanced');
localStorage.setItem('windowSize', JSON.stringify(initialCustomSizes));

rendererLayout.applyLayoutPreset('custom', { persist: true, resetCustomSizes: false });
assert.strictEqual(localStorage.getItem('layoutPreset'), 'custom');
assert.ok(bodyClasses.has('layout-custom'), 'Custom mode class was not enabled');
assert.deepStrictEqual(JSON.parse(localStorage.getItem('customLayoutSizes')), initialCustomSizes);

const updatedCustomSizes = { cpuGroup: { height: 460, span: 2, width: 640 } };
rendererLayout.saveWindowSizes(updatedCustomSizes);
rendererLayout.applyLayoutPreset('wide', { persist: true, resetCustomSizes: true });
assert.strictEqual(localStorage.getItem('layoutPreset'), 'wide');
assert.strictEqual(localStorage.getItem('windowSize'), null);
assert.ok(!bodyClasses.has('layout-custom'), 'Custom mode class stayed enabled for a fixed preset');

rendererLayout.applyLayoutPreset('custom', { persist: true, resetCustomSizes: false });
assert.strictEqual(localStorage.getItem('layoutPreset'), 'custom');
assert.deepStrictEqual(JSON.parse(localStorage.getItem('windowSize')), updatedCustomSizes);
assert.deepStrictEqual(JSON.parse(localStorage.getItem('customLayoutSizes')), updatedCustomSizes);

const summaryCustomSizes = { gpuGroup: { height: 520, span: 3, width: 720 } };
rendererLayout.applyLayoutPreset('custom', { mode: 'summary', persist: true, resetCustomSizes: false });
rendererLayout.saveWindowSizes(summaryCustomSizes, 'summary');
assert.strictEqual(localStorage.getItem('summaryLayoutPreset'), 'custom');
assert.deepStrictEqual(JSON.parse(localStorage.getItem('summaryWindowSize')), summaryCustomSizes);
assert.deepStrictEqual(JSON.parse(localStorage.getItem('summaryCustomLayoutSizes')), summaryCustomSizes);
assert.deepStrictEqual(JSON.parse(localStorage.getItem('windowSize')), updatedCustomSizes, 'Summary resizing changed the normal-mode card geometry');

rendererLayout.applyLayoutPreset('wide', { mode: 'summary', persist: true, resetCustomSizes: true });
assert.strictEqual(localStorage.getItem('summaryLayoutPreset'), 'wide');
assert.strictEqual(localStorage.getItem('summaryWindowSize'), null);
assert.deepStrictEqual(JSON.parse(localStorage.getItem('windowSize')), updatedCustomSizes, 'Changing the Summary layout cleared normal-mode card geometry');

const normalOrder = ['cpuGroup', 'gpuGroup', 'ramGroup'];
const summaryOrder = ['ramGroup', 'cpuGroup', 'gpuGroup'];
rendererLayout.saveWindowOrder(normalOrder, 'normal');
localStorage.removeItem('summaryWindowOrder');
assert.deepStrictEqual(Array.from(rendererLayout.loadWindowOrder('summary')), normalOrder, 'Summary order did not seed from the existing normal order');
rendererLayout.saveWindowOrder(summaryOrder, 'summary');
assert.deepStrictEqual(Array.from(rendererLayout.loadWindowOrder('normal')), normalOrder);
assert.deepStrictEqual(Array.from(rendererLayout.loadWindowOrder('summary')), summaryOrder);
assert.notStrictEqual(localStorage.getItem('windowOrder'), localStorage.getItem('summaryWindowOrder'), 'Summary ordering overwrote the normal card order');

const dragSetupStart = appSource.indexOf('function setupWindowDragAndDrop()');
const dragSetupEnd = appSource.indexOf('\nfunction applyFontSize', dragSetupStart);
const dragSetupSource = appSource.slice(dragSetupStart, dragSetupEnd);
assert.ok(!dragSetupSource.includes('if (summaryModeEnabled)'), 'Summary Mode is still blocked from dragging cards');

console.log('Layout preset and settings snapshot checks passed.');
