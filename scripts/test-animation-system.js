'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

assert(htmlSource.includes('<span>Animations</span>'), 'Appearance is missing its Animations section.');
[
  'animationEnabledToggle',
  'animationSettingsToggle',
  'animationDialogsToggle',
  'animationViewsToggle',
  'animationSensorIconsToggle',
  'animationSettingsIconsToggle',
  'animationSpeedSelect',
  'animationIntensitySelect'
].forEach((id) => assert(htmlSource.includes(`id="${id}"`), `${id} is missing.`));

assert(appSource.includes("const ANIMATION_SETTINGS_KEY = 'animationSettings';"), 'Animation settings do not have a persisted key.');
assert(appSource.includes('function normalizeAnimationSettings(value)'), 'Animation settings normalization is missing.');
assert(appSource.includes('function loadAnimationSettings()'), 'Legacy animation preference migration is missing.');
assert(appSource.includes('function applyAnimationSettings(settings, options = {})'), 'Animation settings application is missing.');
assert(appSource.includes('animations: loadAnimationSettings(),'), 'Web Monitor payload does not include animation settings.');
assert(appSource.includes('applyWebAnimationSettings(settings.animations);'), 'Web Monitor does not apply synced animation settings.');

assert(appSource.includes('function setModalShellVisible(modal, visible)'), 'Shared dialog visibility behavior is missing.');
assert(cssSource.includes('.setup-guide-modal.is-hidden .setup-guide-dialog'), 'Dialog fly-out state is missing.');
assert(cssSource.includes('body.no-dialog-animations .setup-guide-modal'), 'Dialog animation opt-out is missing.');
assert(!cssSource.includes('.setup-guide-modal.is-hidden {\n  display: none;'), 'Dialogs are still removed before their closing animation can run.');

assert(appSource.includes('function triggerDashboardViewTransition(toSummary)'), 'Desktop Summary transition is missing.');
assert(appSource.includes('function triggerWebViewTransition(toSummary)'), 'Web Summary transition is missing.');
assert(cssSource.includes('@keyframes dashboard-to-summary'), 'Desktop Summary keyframes are missing.');
assert(appSource.includes('@keyframes web-dashboard-to-summary'), 'Web Summary keyframes are missing.');

assert(cssSource.includes('@keyframes sensor-card-icon-live'), 'Desktop sensor-card icon motion is missing.');
assert(appSource.includes('@keyframes web-sensor-icon-live'), 'Web sensor-card icon motion is missing.');
assert(cssSource.includes('body:not(.no-sensor-icon-animations) .sensor-group .group-icon'), 'Desktop sensor-icon opt-out is not respected.');
assert(appSource.includes("document.body.classList.toggle('no-sensor-icon-animations'"), 'Web sensor-icon opt-out is not respected.');
assert(cssSource.includes('body:not(.no-settings-icon-animations) .sidebar i::before'), 'Settings-wide icon glyph motion is missing.');
assert(!cssSource.includes('body:not(.no-settings-icon-animations) .sidebar i {\n  display:'), 'Settings icon animation still changes the icon layout box.');
assert(cssSource.includes('.settings-section.is-collapsed .settings-section-content i::before'), 'Hidden settings icons are not paused.');
assert(appSource.includes("document.body.classList.toggle('no-settings-icon-animations'"), 'Settings icon motion does not have an independent opt-out.');
assert(appSource.includes('const ANIMATION_SPEED_PRESETS = Object.freeze({'), 'Animation speed presets are missing.');
assert(appSource.includes('const ANIMATION_INTENSITY_PRESETS = Object.freeze({'), 'Animation intensity presets are missing.');
assert(cssSource.includes('--motion-icon-duration') && cssSource.includes('--motion-view-distance'), 'Animation preset CSS variables are incomplete.');
assert(appSource.includes("root.style.setProperty('--motion-icon-duration'"), 'Desktop animation speed is not applied.');
assert(appSource.includes("root.style.setProperty('--motion-view-distance'"), 'Desktop animation intensity is not applied.');

console.log('Unified animation system checks passed.');
