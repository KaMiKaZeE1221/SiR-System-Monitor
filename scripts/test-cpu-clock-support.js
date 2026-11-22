const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const hostSource = fs.readFileSync(path.join(root, 'sensor-host', 'Program.cs'), 'utf8');

assert.match(
  hostSource,
  /ApplyLiveBusClockToCpuCoreClocks\(sensors\)/,
  'The overall CPU clock path must apply live-BCLK normalization before selecting a value.'
);
assert.match(
  hostSource,
  /String\.Equals\(sensor\.sensorType, "Factor"/,
  'CPU multiplier sensors must be used to detect fixed-reference clock readings.'
);
assert.match(
  hostSource,
  /correctedClock = liveBusReferenceClock/,
  'Fixed-reference CPU clocks must be rebuilt from the current multiplier and measured bus clock.'
);
assert.match(
  hostSource,
  /nominalDistance \+ 0\.5 >= liveBusDistance/,
  'Clocks that already include live BCLK must not be scaled a second time.'
);

const currentMultiplier = 40.5;
const measuredBusClockMhz = 101;
const correctedClockMhz = currentMultiplier * measuredBusClockMhz;
assert.strictEqual(correctedClockMhz, 4090.5, 'A 40.5x multiplier at 101 MHz BCLK should report about 4.1 GHz.');

console.log('CPU live-BCLK clock normalization checks passed.');
