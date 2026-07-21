function listEnabledAlertSensors(groupedSensors, groupOrder, sensorSelection, categorySelection) {
  const groups = groupedSensors && typeof groupedSensors === 'object' ? groupedSensors : {};
  const order = Array.isArray(groupOrder) ? groupOrder : Object.keys(groups);
  const selectedSensors = sensorSelection && typeof sensorSelection === 'object' ? sensorSelection : {};
  const selectedCategories = categorySelection && typeof categorySelection === 'object' ? categorySelection : {};
  const entries = [];

  order.forEach((group) => {
    if (selectedCategories[group] === false) return;
    const sensors = Array.isArray(groups[group]) ? groups[group] : [];
    sensors.forEach((sensor) => {
      const sensorId = String(sensor && sensor.id ? sensor.id : '').trim();
      if (!sensorId || selectedSensors[sensorId] !== true) return;
      entries.push({ group, sensor });
    });
  });

  return entries;
}

module.exports = { listEnabledAlertSensors };
