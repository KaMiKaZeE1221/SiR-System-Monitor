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
  'animationEnabledToggle',
  'animationSettingsToggle',
  'animationDialogsToggle',
  'animationViewsToggle',
  'animationSensorIconsToggle',
  'animationSettingsIconsToggle',
  'animationSpeedSelect',
  'animationIntensitySelect',
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
assert(appSource.includes("const DISABLE_SETTINGS_ANIMATIONS_KEY = 'disableSettingsAnimations';"), 'The settings animation preference key is missing.');
assert(appSource.includes("const ANIMATION_SETTINGS_KEY = 'animationSettings';"), 'The unified animation settings key is missing.');
assert(appSource.includes('DISABLE_SETTINGS_ANIMATIONS_KEY,\n  ANIMATION_SETTINGS_KEY,\n  TEMPERATURE_UNIT_KEY'), 'Animation settings are not included in settings snapshots.');
assert(!htmlSource.includes('id="disableSettingsAnimationsToggle"'), 'The legacy animation switch still appears under Font Settings.');
assert(appSource.includes('function setSettingsDisclosureExpanded('), 'Measured settings disclosure animation behavior is missing.');
assert(!appSource.includes("window.matchMedia('(prefers-reduced-motion: reduce)')"), 'The OS reduced-motion preference still overrides the explicit in-app animation choice.');
assert(cssSource.includes('--accent: var(--settings-panel-accent-color)'), 'Settings controls do not use the independent accent color.');
assert(cssSource.includes('--accent-light: var(--settings-panel-icon-color)'), 'Settings icons do not use the independent icon color.');
assert(appSource.includes("overlayLineLimitsToggle.setAttribute('aria-expanded'"), 'Overlay advanced disclosure state is not accessible.');

const profileUiStart = appSource.indexOf("const settingsProfileSelect = document.getElementById('settingsProfileSelect')");
const profileUiEnd = appSource.indexOf('if (overlayFontFamilySelect)', profileUiStart);
const profileUiSource = appSource.slice(profileUiStart, profileUiEnd);
assert(profileUiStart >= 0 && profileUiEnd > profileUiStart, 'Settings profile actions could not be identified.');
assert(profileUiSource.includes("showThemedMessage('Profile Saved'"), 'Profile-save success does not use the themed in-app dialog.');
assert(profileUiSource.includes("showThemedConfirmation('Delete Profile?'"), 'Profile deletion does not use the themed in-app confirmation.');
assert(!/\b(?:alert|confirm)\s*\(/.test(profileUiSource), 'Settings profile actions still use native unthemed dialogs.');
assert(cssSource.includes('--accent: var(--settings-panel-accent-color);'), 'The shared themed dialog does not inherit the user-selected custom accent color.');
assert(cssSource.includes('--themed-dialog-base: var(--settings-panel-color, var(--bg-secondary));'), 'The shared themed dialog does not inherit the custom settings-panel surface color.');

assert(cssSource.includes('/* Settings workspace redesign */'), 'The settings redesign stylesheet is missing.');
assert(cssSource.includes('.settings-group.is-collapsed > .settings-group-content'), 'Top-level settings collapse behavior is missing.');
assert(cssSource.includes('.settings-section.is-collapsed > .settings-section-content'), 'Settings row collapse behavior is missing.');
assert(appSource.includes("const durationMs = content.classList.contains('settings-group-content') ? animationSpeed.groupMs : animationSpeed.sectionMs;"), 'Settings category and section animation presets are missing.');
assert(appSource.includes("content.style.maxHeight = `${Math.max(0, targetHeight)}px`;"), 'Measured settings max-height transition is missing.');
assert(cssSource.includes('max-height var(--motion-settings-group-duration) ease-in-out'), 'Top-level settings open/close transition is missing.');
assert(cssSource.includes('max-height var(--motion-settings-section-duration) ease-in-out'), 'Settings section open/close transition is missing.');
assert(cssSource.includes('opacity var(--motion-settings-group-duration) ease-in-out'), 'Top-level settings close fade does not match its selected duration.');
assert(cssSource.includes('opacity var(--motion-settings-section-duration) ease-in-out'), 'Settings section close fade does not match its selected duration.');
assert(appSource.includes('non-interpolable `height: auto`'), 'Settings closing motion does not avoid the non-interpolable auto-height path.');
assert(cssSource.includes('.settings-section-content.is-settings-disclosure-preparing'), 'The measured max-height is not locked before the transition begins.');
assert(cssSource.includes('body.no-settings-animations .settings-group-content'), 'The settings disclosure animation opt-out stylesheet is missing.');
assert(!cssSource.includes('@media (prefers-reduced-motion: reduce)'), 'The reduced-motion stylesheet still disables dropdown motion while the in-app option is off.');
assert(!cssSource.includes('.settings-group.is-collapsed > .settings-group-content {\n  display: none;'), 'Top-level settings are still hidden before they can animate.');
assert(!cssSource.includes('.settings-section.is-collapsed > .settings-section-content {\n  display: none;'), 'Settings sections are still hidden before they can animate.');
assert(cssSource.includes('.settings-switch-row input[type="checkbox"]::after'), 'Modern settings switches are missing.');
assert(cssSource.includes('.overlay-settings-cluster,\n.overlay-panel-section'), 'Overlay sections are not using the flat visual hierarchy.');

console.log('Settings workspace redesign checks passed.');
