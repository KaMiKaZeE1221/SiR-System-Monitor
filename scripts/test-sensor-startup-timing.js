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
  let lastSignature = '';

  try {
    while ((Date.now() - startedAt) < durationSeconds * 1000) {
      const result = await reader.getEnhancedData('builtin', { providers });
      const data = result && result.external;
      const diagnostics = data && data.diagnostics ? data.diagnostics : {};
      const groupedSensors = data && data.groupedSensors ? data.groupedSensors : {};
      const total = Object.values(groupedSensors).flat().length;
      const standard = Number(diagnostics.standardSensorCount) || 0;
      const enhanced = Number(diagnostics.enhancedSensorCount) || 0;
      const elapsedMs = Date.now() - startedAt;

      if (standard > 0 && firstStandardAt === null) firstStandardAt = elapsedMs;
      if (enhanced > 0 && firstEnhancedAt === null) firstEnhancedAt = elapsedMs;

      const signature = JSON.stringify({
        total,
        standard,
        enhanced,
        groups: Object.fromEntries(Object.entries(groupedSensors).map(([group, sensors]) => [group, sensors.length])),
        available: diagnostics.enhancedAvailable === true,
        initializing: diagnostics.enhancedInitializing === true,
        warning: diagnostics.warning || null
      });
      if (signature !== lastSignature) {
        console.log(JSON.stringify({ elapsedMs, ...JSON.parse(signature) }));
        lastSignature = signature;
      }
      await wait(250);
    }

    assert(firstStandardAt !== null, 'Standard sensors did not become available during startup.');
    assert(firstStandardAt < 3000, `Standard sensors were too slow (${firstStandardAt} ms).`);
    console.log(JSON.stringify({ firstStandardMs: firstStandardAt, firstEnhancedMs: firstEnhancedAt }, null, 2));
  } finally {
    await reader.close({ forceAfterMs: 2000 });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
