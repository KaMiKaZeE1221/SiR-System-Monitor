const assert = require('assert');
const SensorReader = require('../sensorReader');

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main() {
  const reader = new SensorReader();
  const providers = { builtin: true, enhanced: true, rtss: false, aida64: false, hwinfo: false };

  try {
    let initial = null;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      initial = await reader.getEnhancedData('builtin', { providers });
      if (Number(initial?.external?.diagnostics?.enhancedSensorCount) > 0) break;
      await wait(100);
    }

    const initialSensors = Object.values(initial?.external?.groupedSensors || {}).flat();
    assert(initialSensors.length > 0, 'Initial sensor snapshot is empty.');
    const firstPid = reader.builtinHost.child?.pid;
    assert(firstPid, 'Initial sensor host did not start.');

    reader.builtinHost.child.kill();
    await wait(150);

    const held = await reader.getEnhancedData('builtin', { providers });
    const heldSensors = Object.values(held?.external?.groupedSensors || {}).flat();
    assert(heldSensors.length >= initialSensors.length, 'A transient host exit blanked the sensor catalog.');

    await wait(1600);
    const recovered = await reader.getEnhancedData('builtin', { providers });
    const recoveredSensors = Object.values(recovered?.external?.groupedSensors || {}).flat();
    const secondPid = reader.builtinHost.child?.pid;
    assert(recoveredSensors.length > 0, 'Sensor catalog did not recover after a host exit.');
    assert(secondPid && secondPid !== firstPid, 'Sensor host did not restart after the retry delay.');

    console.log('Sensor host recovery tests passed.');
  } finally {
    await reader.close({ forceAfterMs: 2000 });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
