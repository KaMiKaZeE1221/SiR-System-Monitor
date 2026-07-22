'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

const ids = Array.from(htmlSource.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
assert.strictEqual(new Set(ids).size, ids.length, 'The redesigned settings UI contains duplicate element IDs.');

[
  'settingsSearchInput',
  'settingsSearchClearBtn',
  'settingsSearchStatus',
  'summaryLayoutPresetSelect',
  'customSettingsPanelColor',
  'customSettingsPanelAccentColor',
  'customSettingsPanelIconColor',
  'overlayEnabledToggle',
  'overlayFontFamilySelect',
  'overlayPositionSelect',
  'overlayStyleSelect',
  'overlayMonitorSelect',
  'overlayFontSizeSlider',
  'overlayGroupSpacing',
  'overlayScale',
  'overlayOpacity',
  'overlayLineLimitsToggle',
  'overlayCategoryOrderList',
  'overlayHotkey',
  'overlayTextColor',
  'overlayValueColor',
  'overlayBackgroundColor'
].forEach((id) => {
  assert(htmlSource.includes(`id="${id}"`), `${id} is missing from the redesigned settings UI.`);
});

const overlayStart = htmlSource.indexOf('<span>On-Screen Overlay</span>');
const overlayEnd = htmlSource.indexOf('<span>Temperature Unit</span>', overlayStart);
const overlayMarkup = htmlSource.slice(overlayStart, overlayEnd);
assert(overlayStart >= 0 && overlayEnd > overlayStart, 'The overlay settings region could not be identified.');
assert.strictEqual((overlayMarkup.match(/class="settings-section/g) || []).length, 1, 'Overlay Settings still contains an extra nested settings-section card.');
assert((overlayMarkup.match(/overlay-panel-section/g) || []).length >= 4, 'Overlay Settings is missing its flat logical sections.');
assert(overlayMarkup.includes('overlayGroupSpacingValue') && overlayMarkup.includes('overlayScaleValue') && overlayMarkup.includes('overlayOpacityValue'), 'Overlay slider readouts are incomplete.');

assert(appSource.includes('function setupSettingsSearch()'), 'Settings-wide search behavior is missing.');
assert(appSource.includes('const SETTINGS_GROUP_PRESENTATION = {'), 'Settings category presentation metadata is missing.');
assert(appSource.includes('updateOverlayRangeReadouts(settings);'), 'Overlay range readouts are not synchronized when settings are applied.');
assert(appSource.includes("document.body.style.setProperty('--settings-panel-color'"), 'The independent settings-panel color is not applied.');
assert(appSource.includes("document.body.style.setProperty('--settings-panel-accent-color'"), 'The independent settings accent color is not applied.');
assert(appSource.includes("document.body.style.setProperty('--settings-panel-icon-color'"), 'The independent settings icon color is not applied.');
assert(cssSource.includes('--accent: var(--settings-panel-accent-color)'), 'Settings controls do not use the independent accent color.');
assert(cssSource.includes('--accent-light: var(--settings-panel-icon-color)'), 'Settings icons do not use the independent icon color.');
assert(appSource.includes("overlayLineLimitsToggle.setAttribute('aria-expanded'"), 'Overlay advanced disclosure state is not accessible.');

assert(cssSource.includes('/* Settings workspace redesign */'), 'The settings redesign stylesheet is missing.');
assert(cssSource.includes('.settings-group.is-collapsed > .settings-group-content'), 'Top-level settings collapse behavior is missing.');
assert(cssSource.includes('.settings-section.is-collapsed > .settings-section-content'), 'Settings row collapse behavior is missing.');
assert(cssSource.includes('.settings-switch-row input[type="checkbox"]::after'), 'Modern settings switches are missing.');
assert(cssSource.includes('.overlay-settings-cluster,\n.overlay-panel-section'), 'Overlay sections are not using the flat visual hierarchy.');

console.log('Settings workspace redesign checks passed.');
