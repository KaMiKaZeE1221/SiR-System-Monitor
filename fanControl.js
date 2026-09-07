'use strict';

const DEFAULT_FAN_CURVE = Object.freeze([
  Object.freeze({ temperature: 30, percent: 30 }),
  Object.freeze({ temperature: 50, percent: 45 }),
  Object.freeze({ temperature: 70, percent: 70 }),
  Object.freeze({ temperature: 85, percent: 100 })
]);

const DEFAULT_CHANNEL = Object.freeze({
  mode: 'default',
  displayName: '',
  collapsed: false,
  hidden: false,
  offsetPercent: 0,
  manualPercent: 50,
  primarySensorId: '',
  secondarySensorId: '',
  sensorMode: 'single',
  minimumPercent: 30,
  hysteresis: 2,
  emergencyTemperature: 90,
  curvePoints: DEFAULT_FAN_CURVE
});

function clampNumber(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(minimum, Math.min(maximum, numeric));
}

function normalizeCurvePoints(points) {
  const input = Array.isArray(points) ? points : DEFAULT_FAN_CURVE;
  const normalized = input
    .slice(0, 8)
    .map((point, index) => ({
      temperature: clampNumber(point?.temperature, 0, 120, DEFAULT_FAN_CURVE[Math.min(index, DEFAULT_FAN_CURVE.length - 1)].temperature),
      percent: clampNumber(point?.percent, 20, 100, DEFAULT_FAN_CURVE[Math.min(index, DEFAULT_FAN_CURVE.length - 1)].percent)
    }))
    .sort((left, right) => left.temperature - right.temperature);

  return normalized.length >= 2
    ? normalized
    : DEFAULT_FAN_CURVE.map((point) => ({ ...point }));
}

function normalizeFanChannel(value = {}) {
  const mode = ['default', 'manual', 'curve', 'global'].includes(String(value?.mode || '').toLowerCase())
    ? String(value.mode).toLowerCase()
    : DEFAULT_CHANNEL.mode;
  const sensorMode = String(value?.sensorMode || '').toLowerCase() === 'average'
    ? 'average'
    : 'single';

  return {
    mode,
    displayName: String(value?.displayName || '').trim().slice(0, 80),
    collapsed: value?.collapsed === true,
    hidden: value?.hidden === true,
    offsetPercent: clampNumber(value?.offsetPercent, -50, 50, DEFAULT_CHANNEL.offsetPercent),
    manualPercent: clampNumber(value?.manualPercent, 20, 100, DEFAULT_CHANNEL.manualPercent),
    primarySensorId: String(value?.primarySensorId || '').trim(),
    secondarySensorId: sensorMode === 'average' ? String(value?.secondarySensorId || '').trim() : '',
    sensorMode,
    minimumPercent: clampNumber(value?.minimumPercent, 20, 100, DEFAULT_CHANNEL.minimumPercent),
    hysteresis: clampNumber(value?.hysteresis, 0, 10, DEFAULT_CHANNEL.hysteresis),
    emergencyTemperature: clampNumber(value?.emergencyTemperature, 50, 110, DEFAULT_CHANNEL.emergencyTemperature),
    curvePoints: normalizeCurvePoints(value?.curvePoints)
  };
}

function normalizeFanCurve(value = {}) {
  const normalized = normalizeFanChannel({ ...value, mode: 'curve' });
  return {
    primarySensorId: normalized.primarySensorId,
    secondarySensorId: normalized.secondarySensorId,
    sensorMode: normalized.sensorMode,
    minimumPercent: normalized.minimumPercent,
    hysteresis: normalized.hysteresis,
    emergencyTemperature: normalized.emergencyTemperature,
    curvePoints: normalized.curvePoints
  };
}

function normalizeFanControlSettings(value = {}) {
  let input = value;
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch (error) { input = {}; }
  }
  if (!input || typeof input !== 'object') input = {};

  const channels = {};
  Object.entries(input.channels || {}).forEach(([controlId, channel]) => {
    const id = String(controlId || '').trim();
    if (!id) return;
    channels[id] = normalizeFanChannel(channel);
  });

  return {
    enabled: input.enabled === true,
    channels,
    globalCurve: normalizeFanCurve(input.globalCurve || {}),
    curveStudioCollapsed: input.curveStudioCollapsed === true
  };
}

function interpolateFanCurve(points, temperature) {
  const curve = normalizeCurvePoints(points);
  const current = Number(temperature);
  if (!Number.isFinite(current)) return null;
  if (current <= curve[0].temperature) return curve[0].percent;
  if (current >= curve[curve.length - 1].temperature) return curve[curve.length - 1].percent;

  for (let index = 1; index < curve.length; index += 1) {
    const upper = curve[index];
    const lower = curve[index - 1];
    if (current > upper.temperature) continue;
    const span = Math.max(0.001, upper.temperature - lower.temperature);
    const ratio = (current - lower.temperature) / span;
    return lower.percent + ((upper.percent - lower.percent) * ratio);
  }
  return curve[curve.length - 1].percent;
}

function combineTemperatureValues(primary, secondary, sensorMode = 'single') {
  if (primary === null || primary === undefined || primary === '') return null;
  const first = Number(primary);
  if (!Number.isFinite(first)) return null;
  if (String(sensorMode).toLowerCase() !== 'average') return first;
  if (secondary === null || secondary === undefined || secondary === '') return null;
  const second = Number(secondary);
  if (!Number.isFinite(second)) return null;
  return (first + second) / 2;
}

module.exports = {
  DEFAULT_FAN_CURVE,
  DEFAULT_CHANNEL,
  normalizeCurvePoints,
  normalizeFanChannel,
  normalizeFanCurve,
  normalizeFanControlSettings,
  interpolateFanCurve,
  combineTemperatureValues
};
