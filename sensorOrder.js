function reorderVisibleSensors(order, sensorId, targetSensorId, placeAfter, visibleSensorIds) {
  const list = Array.isArray(order) ? [...order] : [];
  if (!sensorId || !targetSensorId || sensorId === targetSensorId) return list;

  const visibleSet = new Set(
    (Array.isArray(visibleSensorIds) && visibleSensorIds.length ? visibleSensorIds : list)
      .filter((id) => list.includes(id))
  );
  if (!visibleSet.has(sensorId) || !visibleSet.has(targetSensorId)) return list;

  const visibleOrder = list.filter((id) => visibleSet.has(id));
  const sourceIndex = visibleOrder.indexOf(sensorId);
  const targetIndex = visibleOrder.indexOf(targetSensorId);
  if (sourceIndex === -1 || targetIndex === -1) return list;

  const [moved] = visibleOrder.splice(sourceIndex, 1);
  let insertIndex = visibleOrder.indexOf(targetSensorId);
  if (insertIndex === -1) return list;
  if (placeAfter) insertIndex += 1;
  visibleOrder.splice(insertIndex, 0, moved);

  let visibleIndex = 0;
  return list.map((id) => visibleSet.has(id) ? visibleOrder[visibleIndex++] : id);
}

module.exports = {
  reorderVisibleSensors
};
