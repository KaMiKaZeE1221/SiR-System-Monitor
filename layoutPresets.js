'use strict';

const DEFAULT_LAYOUT_PRESET = 'balanced';
const LAYOUT_PRESET_STORAGE_KEY = 'layoutPreset';
const CUSTOM_LAYOUT_CONFIG_STORAGE_KEY = 'customLayoutConfig';
const CUSTOM_LAYOUT_SIZES_STORAGE_KEY = 'customLayoutSizes';

const LAYOUT_PRESETS = Object.freeze({
  compact: Object.freeze({
    id: 'compact',
    label: 'Compact',
    minCardWidth: 220,
    cardHeight: 320,
    gap: 10,
    stacked: false
  }),
  balanced: Object.freeze({
    id: 'balanced',
    label: 'Balanced',
    minCardWidth: 300,
    cardHeight: 360,
    gap: 14,
    stacked: false
  }),
  wide: Object.freeze({
    id: 'wide',
    label: 'Wide',
    minCardWidth: 420,
    cardHeight: 400,
    gap: 16,
    stacked: false
  }),
  stacked: Object.freeze({
    id: 'stacked',
    label: 'Stacked',
    minCardWidth: 300,
    cardHeight: 420,
    gap: 14,
    stacked: true
  }),
  custom: Object.freeze({
    id: 'custom',
    label: 'Custom',
    minCardWidth: 300,
    cardHeight: 360,
    gap: 14,
    stacked: false,
    custom: true
  })
});

function normalizeLayoutPreset(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(LAYOUT_PRESETS, normalized)
    ? normalized
    : DEFAULT_LAYOUT_PRESET;
}

function getLayoutPreset(value) {
  return LAYOUT_PRESETS[normalizeLayoutPreset(value)];
}

module.exports = {
  DEFAULT_LAYOUT_PRESET,
  LAYOUT_PRESET_STORAGE_KEY,
  CUSTOM_LAYOUT_CONFIG_STORAGE_KEY,
  CUSTOM_LAYOUT_SIZES_STORAGE_KEY,
  LAYOUT_PRESETS,
  normalizeLayoutPreset,
  getLayoutPreset
};
