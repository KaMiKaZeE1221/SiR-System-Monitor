function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function kilobytesToBytes(value) {
  return Math.max(0, finiteNumber(value)) * 1024;
}

function summarizeElectronAppMetrics(processMetrics, options = {}) {
  const metrics = Array.isArray(processMetrics) ? processMetrics : [];
  const totals = metrics.reduce((summary, metric) => {
    const type = String(metric && metric.type || '').trim().toLowerCase();
    const cpu = metric && metric.cpu && typeof metric.cpu === 'object' ? metric.cpu : {};
    const memory = metric && metric.memory && typeof metric.memory === 'object' ? metric.memory : {};

    summary.cpuPercent += Math.max(0, finiteNumber(cpu.percentCPUUsage));
    summary.workingSetBytes += kilobytesToBytes(memory.workingSetSize);
    summary.peakWorkingSetBytes += kilobytesToBytes(memory.peakWorkingSetSize);
    summary.privateBytes += kilobytesToBytes(memory.privateBytes);
    if (type.includes('tab') || type.includes('renderer')) summary.rendererProcessCount += 1;
    if (type.includes('utility')) summary.utilityProcessCount += 1;
    if (type.includes('gpu')) summary.gpuProcessCount += 1;
    return summary;
  }, {
    cpuPercent: 0,
    workingSetBytes: 0,
    peakWorkingSetBytes: 0,
    privateBytes: 0,
    rendererProcessCount: 0,
    utilityProcessCount: 0,
    gpuProcessCount: 0
  });

  return {
    ...totals,
    processCount: metrics.length,
    windowCount: Math.max(0, Math.round(finiteNumber(options.windowCount))),
    visibleWindowCount: Math.max(0, Math.round(finiteNumber(options.visibleWindowCount))),
    uptimeSeconds: Math.max(0, finiteNumber(options.uptimeSeconds))
  };
}

function createAppSensor(id, name, value, units, options = {}) {
  return {
    id,
    name,
    value: finiteNumber(value),
    units,
    group: 'app',
    hardwareType: 'App',
    sensorType: options.sensorType || 'data',
    provider: 'sir-app',
    defaultEnabled: options.defaultEnabled === true
  };
}

function buildAppTelemetrySensors(runtimeStats = {}, context = {}) {
  const bytesToMegabytes = (value) => Math.max(0, finiteNumber(value)) / (1024 * 1024);
  const count = (value) => Math.max(0, Math.round(finiteNumber(value)));
  const primaryMemoryBytes = finiteNumber(runtimeStats.privateBytes) > 0
    ? runtimeStats.privateBytes
    : runtimeStats.workingSetBytes;

  return [
    createAppSensor('app_cpu_usage', 'SiR CPU Usage', runtimeStats.cpuPercent, '%', { sensorType: 'load', defaultEnabled: true }),
    createAppSensor('app_memory_usage', 'SiR Memory Usage', bytesToMegabytes(primaryMemoryBytes), 'MB', { sensorType: 'data', defaultEnabled: true }),
    createAppSensor('app_working_set_memory', 'SiR Working Set Memory', bytesToMegabytes(runtimeStats.workingSetBytes), 'MB'),
    createAppSensor('app_peak_memory', 'SiR Peak Memory', bytesToMegabytes(runtimeStats.peakWorkingSetBytes), 'MB'),
    createAppSensor('app_process_count', 'SiR Process Count', count(runtimeStats.processCount), 'processes', { sensorType: 'count', defaultEnabled: true }),
    createAppSensor('app_renderer_process_count', 'Renderer Process Count', count(runtimeStats.rendererProcessCount), 'processes', { sensorType: 'count' }),
    createAppSensor('app_utility_process_count', 'Utility Process Count', count(runtimeStats.utilityProcessCount), 'processes', { sensorType: 'count' }),
    createAppSensor('app_gpu_process_count', 'GPU Process Count', count(runtimeStats.gpuProcessCount), 'processes', { sensorType: 'count' }),
    createAppSensor('app_window_count', 'App Window Count', count(runtimeStats.windowCount), 'windows', { sensorType: 'count' }),
    createAppSensor('app_visible_window_count', 'Visible App Windows', count(runtimeStats.visibleWindowCount), 'windows', { sensorType: 'count' }),
    createAppSensor('app_uptime', 'SiR App Uptime', runtimeStats.uptimeSeconds, 's', { sensorType: 'time', defaultEnabled: true }),
    createAppSensor('app_refresh_interval', 'Sensor Refresh Interval', Math.max(0, finiteNumber(context.refreshIntervalMs)), 'ms', { sensorType: 'time', defaultEnabled: true }),
    createAppSensor('app_sensor_read_duration', 'Last Sensor Read Duration', Math.max(0, finiteNumber(context.sensorReadDurationMs)), 'ms', { sensorType: 'time', defaultEnabled: true }),
    createAppSensor('app_update_cycle_duration', 'Last Update Cycle Duration', Math.max(0, finiteNumber(context.updateCycleDurationMs)), 'ms', { sensorType: 'time' }),
    createAppSensor('app_detected_sensor_count', 'Detected Hardware Sensors', count(context.detectedSensorCount), 'sensors', { sensorType: 'count', defaultEnabled: true }),
    createAppSensor('app_enabled_sensor_count', 'Enabled Hardware Sensors', count(context.enabledSensorCount), 'sensors', { sensorType: 'count' }),
    createAppSensor('app_active_alert_count', 'Active Sensor Alerts', count(context.activeAlertCount), 'alerts', { sensorType: 'count' }),
    createAppSensor('app_web_connection_count', 'Web Monitor Connections', count(context.webConnectionCount), 'connections', { sensorType: 'count' })
  ];
}

module.exports = {
  summarizeElectronAppMetrics,
  buildAppTelemetrySensors
};
