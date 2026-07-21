const SENSOR_CATALOG_CACHE_VERSION = 1;
const SENSOR_CATALOG_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SENSOR_DETECTING_VALUE = 'Detecting...';

function createEmptyCatalog(groupOrder) {
  return Object.fromEntries((Array.isArray(groupOrder) ? groupOrder : []).map((group) => [group, []]));
}

function sanitizeCachedSensor(sensor, group) {
  const id = String(sensor && sensor.id ? sensor.id : '').trim();
  if (!id) return null;
  return {
    id,
    name: String(sensor.name || id),
    value: SENSOR_DETECTING_VALUE,
    units: String(sensor.units || ''),
    group: String(sensor.group || group),
    provider: String(sensor.provider || 'builtin'),
    hardwareType: String(sensor.hardwareType || ''),
    sensorType: String(sensor.sensorType || ''),
    defaultEnabled: sensor.defaultEnabled !== false
  };
}

function createSensorCatalogCachePayload(groupedSensors, groupOrder, savedAt = Date.now()) {
  const groups = createEmptyCatalog(groupOrder);
  (groupOrder || []).forEach((group) => {
    const seen = new Set();
    groups[group] = (Array.isArray(groupedSensors?.[group]) ? groupedSensors[group] : [])
      .map((sensor) => sanitizeCachedSensor(sensor, group))
      .filter((sensor) => sensor && !seen.has(sensor.id) && seen.add(sensor.id));
  });
  return { version: SENSOR_CATALOG_CACHE_VERSION, savedAt, groups };
}

function parseSensorCatalogCache(raw, groupOrder, now = Date.now()) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || parsed.version !== SENSOR_CATALOG_CACHE_VERSION) return null;
    const savedAt = Number(parsed.savedAt);
    if (!Number.isFinite(savedAt) || savedAt <= 0 || (now - savedAt) > SENSOR_CATALOG_CACHE_MAX_AGE_MS) return null;
    return createSensorCatalogCachePayload(parsed.groups || {}, groupOrder, savedAt).groups;
  } catch (error) {
    return null;
  }
}

function mergeLiveAndCachedCatalog(liveGroupedSensors, cachedGroupedSensors, groupOrder) {
  const merged = createEmptyCatalog(groupOrder);
  (groupOrder || []).forEach((group) => {
    const live = Array.isArray(liveGroupedSensors?.[group]) ? liveGroupedSensors[group] : [];
    const cached = Array.isArray(cachedGroupedSensors?.[group]) ? cachedGroupedSensors[group] : [];
    const seen = new Set(live.map((sensor) => String(sensor && sensor.id ? sensor.id : '')).filter(Boolean));
    merged[group] = [...live];
    cached.forEach((sensor) => {
      const cachedSensor = sanitizeCachedSensor(sensor, group);
      if (!cachedSensor || seen.has(cachedSensor.id)) return;
      seen.add(cachedSensor.id);
      merged[group].push(cachedSensor);
    });
  });
  return merged;
}

module.exports = {
  SENSOR_DETECTING_VALUE,
  createSensorCatalogCachePayload,
  parseSensorCatalogCache,
  mergeLiveAndCachedCatalog
};
