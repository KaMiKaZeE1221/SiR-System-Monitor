const DIAGNOSTIC_TESTS = Object.freeze([
  Object.freeze({
    id: 'system-report',
    label: 'System & App Report',
    description: 'Collect version, Windows, CPU, memory, display, GPU, permissions, and Electron process information.',
    icon: 'bi-info-circle',
    kind: 'system',
    timeoutMs: 10_000
  }),
  Object.freeze({
    id: 'sensor-check',
    label: 'Quick Sensor Check',
    description: 'Verify the built-in collector and report detected sensor groups, timing, memory use, FPS support, and PSU coverage.',
    icon: 'bi-speedometer2',
    kind: 'script',
    script: 'test-sensor-host.js',
    args: [],
    timeoutMs: 15_000
  }),
  Object.freeze({
    id: 'enhanced-sensor-check',
    label: 'Enhanced Hardware Check',
    description: 'Exercise enhanced discovery and report availability for processor, graphics, motherboard, controller, and peripheral sensors.',
    icon: 'bi-cpu',
    kind: 'script',
    script: 'test-sensor-host.js',
    args: ['--enhanced'],
    timeoutMs: 25_000
  }),
  Object.freeze({
    id: 'startup-timing',
    label: 'Sensor Startup Timing',
    description: 'Measure when standard and enhanced sensor families become available during a fresh 12-second discovery window.',
    icon: 'bi-stopwatch',
    kind: 'script',
    script: 'test-sensor-startup-timing.js',
    args: ['--seconds=12'],
    timeoutMs: 25_000
  }),
  Object.freeze({
    id: 'collector-recovery',
    label: 'Collector Recovery Check',
    description: 'Confirm a test collector can recover its sensor catalogue after its own child process is deliberately restarted.',
    icon: 'bi-arrow-repeat',
    kind: 'script',
    script: 'test-sensor-host-recovery.js',
    args: [],
    timeoutMs: 20_000
  }),
  Object.freeze({
    id: 'performance-benchmark',
    label: 'Sensor Performance Benchmark',
    description: 'Measure collector CPU, memory, request latency, and timing over an eight-second sampling run.',
    icon: 'bi-activity',
    kind: 'script',
    script: 'benchmark-sensor-host.js',
    args: ['--seconds=8'],
    timeoutMs: 25_000
  })
]);

function getDiagnosticDefinition(id) {
  const normalized = String(id || '').trim().toLowerCase();
  return DIAGNOSTIC_TESTS.find((test) => test.id === normalized) || null;
}

function listPublicDiagnostics() {
  return DIAGNOSTIC_TESTS.map(({ id, label, description, icon, kind }) => ({
    id,
    label,
    description,
    icon,
    kind
  }));
}

module.exports = {
  DIAGNOSTIC_TESTS,
  getDiagnosticDefinition,
  listPublicDiagnostics
};
