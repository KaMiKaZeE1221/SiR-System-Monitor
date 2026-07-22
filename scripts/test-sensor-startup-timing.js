const assert = require('assert');
const SensorReader = require('../sensorReader');

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const durationArg = process.argv.find((arg) => /^--seconds=\d+$/.test(arg));
const durationSeconds = durationArg ? Math.max(3, Number(durationArg.split('=')[1])) : 15;

async function main() {
  const providers = { builtin: true, enhanced: true, rtss: false, aida64: false, hwinfo: false };
  if (process.argv.includes('--restart')) {
    const warmReader = new SensorReader();
    try {
      const warmStartedAt = Date.now();
      while ((Date.now() - warmStartedAt) < 5000) {
        const result = await warmReader.getEnhancedData('builtin', { providers });
        if (Number(result?.external?.diagnostics?.enhancedSensorCount) > 0) break;
        await wait(100);
      }
    } finally {
      await warmReader.close({ forceAfterMs: 2000 });
    }
  }

  const reader = new SensorReader();
  const startedAt = Date.now();
  let firstStandardAt = null;
  let firstEnhancedAt = null;
  let firstProcessorAt = null;
  let firstGraphicsAt = null;
  let firstBoardAt = null;
  let firstPeripheralAt = null;
  let fullyInitializedAt = null;
  let slowestSnapshotMs = 0;
  let lastSignature = '';

  try {
    while ((Date.now() - startedAt) < durationSeconds * 1000) {
      const snapshotStartedAt = Date.now();
      const result = await reader.getEnhancedData('builtin', { providers });
      const snapshotMs = Date.now() - snapshotStartedAt;
      slowestSnapshotMs = Math.max(slowestSnapshotMs, snapshotMs);
      const data = result && result.external;
      const diagnostics = data && data.diagnostics ? data.diagnostics : {};
      const groupedSensors = data && data.groupedSensors ? data.groupedSensors : {};
      const total = Object.values(groupedSensors).flat().length;
      const standard = Number(diagnostics.standardSensorCount) || 0;
      const enhanced = Number(diagnostics.enhancedSensorCount) || 0;
      const elapsedMs = Date.now() - startedAt;

      if (standard > 0 && firstStandardAt === null) firstStandardAt = elapsedMs;
      if (enhanced > 0 && firstEnhancedAt === null) firstEnhancedAt = elapsedMs;
      if (diagnostics.enhancedProcessorAvailable === true && firstProcessorAt === null) firstProcessorAt = elapsedMs;
      if (diagnostics.enhancedGraphicsAvailable === true && firstGraphicsAt === null) firstGraphicsAt = elapsedMs;
      if (diagnostics.enhancedBoardAvailable === true && firstBoardAt === null) firstBoardAt = elapsedMs;
      if (diagnostics.enhancedPeripheralAvailable === true && firstPeripheralAt === null) firstPeripheralAt = elapsedMs;
      if (diagnostics.enhancedInitializing === false && fullyInitializedAt === null) fullyInitializedAt = elapsedMs;

      const signature = JSON.stringify({
        total,
        standard,
        enhanced,
        groups: Object.fromEntries(Object.entries(groupedSensors).map(([group, sensors]) => [group, sensors.length])),
        available: diagnostics.enhancedAvailable === true,
        initializing: diagnostics.enhancedInitializing === true,
        processor: diagnostics.enhancedProcessorAvailable === true,
        graphics: diagnostics.enhancedGraphicsAvailable === true,
        board: diagnostics.enhancedBoardAvailable === true,
        peripheral: diagnostics.enhancedPeripheralAvailable === true,
        warning: diagnostics.warning || null
      });
      if (signature !== lastSignature) {
        console.log(JSON.stringify({ elapsedMs, snapshotMs, ...JSON.parse(signature) }));
        lastSignature = signature;
      }
      await wait(250);
    }

    assert(firstStandardAt !== null, 'Standard sensors did not become available during startup.');
    assert(firstStandardAt < 3000, `Standard sensors were too slow (${firstStandardAt} ms).`);
    console.log(JSON.stringify({
      firstStandardMs: firstStandardAt,
      firstEnhancedMs: firstEnhancedAt,
      firstProcessorMs: firstProcessorAt,
      firstGraphicsMs: firstGraphicsAt,
      firstBoardMs: firstBoardAt,
      firstPeripheralMs: firstPeripheralAt,
      fullyInitializedMs: fullyInitializedAt,
      slowestSnapshotMs
    }, null, 2));
  } finally {
    await reader.close({ forceAfterMs: 2000 });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
