const NETWORK_RATE_UNITS = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s'];
const NETWORK_TOTAL_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

function normalizeUnitKey(units) {
  return String(units || '').trim().toLowerCase();
}

function findCanonicalUnit(units, candidates) {
  const key = normalizeUnitKey(units);
  if (!key) return '';

  const aliases = {
    byte: 'B',
    bytes: 'B',
    'byte/s': 'B/s',
    'bytes/s': 'B/s'
  };
  if (aliases[key] && candidates.includes(aliases[key])) return aliases[key];
  return candidates.find((candidate) => candidate.toLowerCase() === key) || '';
}

function classifyNetworkSensor(sensor) {
  const name = String(sensor && sensor.name ? sensor.name : '').toLowerCase();
  const sensorType = String(sensor && sensor.sensorType ? sensor.sensorType : '').toLowerCase();

  if (name.includes('ip address') || name.includes('mac address')) return 'text';
  if (name.includes('link speed') || name.includes('connection speed')) return 'link';

  if (
    sensorType === 'data' ||
    sensorType === 'smalldata' ||
    name.includes('data uploaded') ||
    name.includes('data downloaded') ||
    name.includes('total download') ||
    name.includes('total upload') ||
    name.includes('total dl') ||
    name.includes('total up')
  ) {
    return 'total';
  }

  if (
    sensorType === 'throughput' ||
    name.includes('download rate') ||
    name.includes('upload rate') ||
    name.includes('current dl rate') ||
    name.includes('current up rate') ||
    name.includes('download speed') ||
    name.includes('upload speed')
  ) {
    return 'rate';
  }

  if (sensorType === 'load' || name.includes('usage') || name.includes('utilization') || name.includes('load')) {
    return 'percent';
  }

  if (name.includes('tx') || name.includes('rx') || name.includes('throughput')) return 'throughput';
  return 'other';
}

function resolveNetworkDisplayUnits(sensor, normalizedUnits = '') {
  const kind = classifyNetworkSensor(sensor);
  const sensorType = String(sensor && sensor.sensorType ? sensor.sensorType : '').toLowerCase();
  const normalizedRate = findCanonicalUnit(normalizedUnits, NETWORK_RATE_UNITS);
  const normalizedTotal = findCanonicalUnit(normalizedUnits, NETWORK_TOTAL_UNITS);

  if (kind === 'text') return '';
  if (kind === 'link') return normalizedUnits || 'Mbps';
  if (kind === 'percent') return '%';

  if (kind === 'total') {
    if (normalizedTotal) return normalizedTotal;
    if (sensorType === 'data') return 'GB';
    if (sensorType === 'smalldata') return 'MB';
    return 'MB';
  }

  if (kind === 'rate') {
    if (normalizedRate) return normalizedRate;
    if (normalizedUnits && /bps$/i.test(normalizedUnits)) return normalizedUnits;
    return sensorType === 'throughput' ? 'B/s' : 'KB/s';
  }

  if (kind === 'throughput') return normalizedUnits || 'Mbps';
  return normalizedUnits || '';
}

function scaleBinaryNetworkValue(value, units, kind) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return { value, units };

  const candidates = kind === 'rate'
    ? NETWORK_RATE_UNITS
    : kind === 'total'
      ? NETWORK_TOTAL_UNITS
      : null;
  if (!candidates) return { value: numericValue, units };

  const canonical = findCanonicalUnit(units, candidates);
  if (!canonical) return { value: numericValue, units };

  let displayValue = numericValue;
  let unitIndex = candidates.indexOf(canonical);
  while (Math.abs(displayValue) >= 1024 && unitIndex < candidates.length - 1) {
    displayValue /= 1024;
    unitIndex += 1;
  }

  return {
    value: displayValue,
    units: candidates[unitIndex]
  };
}

module.exports = {
  classifyNetworkSensor,
  resolveNetworkDisplayUnits,
  scaleBinaryNetworkValue
};
