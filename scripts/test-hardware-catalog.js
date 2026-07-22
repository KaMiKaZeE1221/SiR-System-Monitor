const assert = require('assert');
const fs = require('fs');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '..');
const catalogPath = path.join(workspaceRoot, 'sensor-host', 'HardwareDeviceCatalog.cs');
const readersPath = path.join(workspaceRoot, 'sensor-host', 'PsuReaders.cs');
const programPath = path.join(workspaceRoot, 'sensor-host', 'Program.cs');
const supportPath = path.join(workspaceRoot, 'sensor-host', 'HARDWARE-SUPPORT.md');

const catalogSource = fs.readFileSync(catalogPath, 'utf8');
const readersSource = fs.readFileSync(readersPath, 'utf8');
const programSource = fs.readFileSync(programPath, 'utf8');
const supportDocument = fs.readFileSync(supportPath, 'utf8');
const definitionPattern = /new UsbHardwareDefinition\(0x([0-9A-Fa-f]{4}),\s*0x([0-9A-Fa-f]{4}),\s*"([^"]+)",\s*([A-Za-z0-9]+)\)/g;
const definitions = [];
let match;
while ((match = definitionPattern.exec(catalogSource)) !== null) {
  definitions.push({
    usbId: `${match[1]}:${match[2]}`.toUpperCase(),
    name: match[3],
    protocolConstant: match[4]
  });
}

assert.strictEqual(definitions.length, 19, 'The native PSU catalog must contain 19 protocol-backed USB IDs.');
assert.strictEqual(new Set(definitions.map((device) => device.usbId)).size, definitions.length, 'The native PSU catalog contains a duplicate USB ID.');
assert.strictEqual(new Set(definitions.map((device) => device.protocolConstant)).size, 3, 'The native PSU catalog must contain three independent protocol families.');
assert.strictEqual(definitions.filter((device) => device.protocolConstant === 'CorsairHidPsuProtocol').length, 15, 'The Corsair HXi/RMi USB ID table is incomplete.');
assert.strictEqual(definitions.filter((device) => device.protocolConstant === 'NzxtEPsuProtocol').length, 3, 'The NZXT E-series USB ID table is incomplete.');
assert.strictEqual(definitions.filter((device) => device.protocolConstant === 'ThermaltakeDpsProtocol').length, 1, 'The Thermaltake DPS protocol entry is missing.');

definitions.forEach((device) => {
  assert(supportDocument.includes(`\`${device.usbId}\``), `${device.usbId} is missing from HARDWARE-SUPPORT.md.`);
});

assert(!definitions.some((device) => device.usbId === '1B1C:1C02' || device.usbId === '1B1C:1C11'), 'Corsair AXi devices must not be matched to the incompatible HXi/RMi HID protocol.');
assert(supportDocument.includes('1B1C:1C02') && supportDocument.includes('1B1C:1C11'), 'The incompatible AXi exclusions are not documented.');
assert(readersSource.includes('Thread.Sleep(3)'), 'The NZXT PMBus bridge timing guard is missing.');
assert(readersSource.includes('now.AddSeconds(10)') || readersSource.includes('_nextOpenAttempt = now.AddSeconds(10)'), 'Disconnected-device retry throttling is missing.');
assert(!/SetFan|SetSpeed|SetOcp|SetRail|WriteConfiguration/i.test(readersSource), 'A configuration-writing PSU operation was added to the telemetry reader.');
const snapshotStart = programSource.indexOf('public Snapshot ReadSnapshot()');
const snapshotEnd = programSource.indexOf('private void QueueDirectPsuPolls()', snapshotStart);
const snapshotSource = programSource.slice(snapshotStart, snapshotEnd);
assert(snapshotStart >= 0 && snapshotEnd > snapshotStart, 'The primary sensor snapshot path could not be identified.');
assert(snapshotSource.includes('QueueDirectPsuPolls();'), 'Direct PSU refreshes are not queued from the primary snapshot path.');
assert(!snapshotSource.includes('_thermaltakePsu.ReadSnapshot()'), 'Thermaltake HID reads still block the primary sensor snapshot.');
assert(!snapshotSource.includes('_corsairPsu.ReadSnapshot()'), 'Corsair HID reads still block the primary sensor snapshot.');
assert(!snapshotSource.includes('_nzxtEPsu.ReadSnapshot()'), 'NZXT HID reads still block the primary sensor snapshot.');
assert(programSource.includes('DirectPsuSnapshotRetentionSeconds = 15'), 'The last valid direct-PSU snapshot is not retained across transient HID timeouts.');
assert(!programSource.slice(programSource.indexOf('private bool ShouldSkipEnhancedPsu'), programSource.indexOf('private static string BuildSensorName')).includes('.IsActive'), 'Enhanced PSU deduplication can still block on a direct HID reader lock.');

console.log(JSON.stringify({
  directPsuUsbIds: definitions.length,
  protocolFamilies: new Set(definitions.map((device) => device.protocolConstant)).size,
  corsairIds: definitions.filter((device) => device.protocolConstant === 'CorsairHidPsuProtocol').length,
  nzxtIds: definitions.filter((device) => device.protocolConstant === 'NzxtEPsuProtocol').length,
  thermaltakeIds: definitions.filter((device) => device.protocolConstant === 'ThermaltakeDpsProtocol').length
}, null, 2));
