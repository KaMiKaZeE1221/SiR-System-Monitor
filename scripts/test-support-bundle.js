'use strict';

const assert = require('assert');
const { createSupportZip, sanitizeSupportText, sanitizeSupportValue } = require('../supportBundle');

const identity = { userName: 'TestUser', hostName: 'Private-PC' };
const scrubbedText = sanitizeSupportText(
  'C:\\Users\\TestUser\\AppData on Private-PC at 192.168.1.44, AA:BB:CC:DD:EE:FF, test@example.com, token=abc123',
  identity
);
assert(!scrubbedText.includes('TestUser'), 'User names must be redacted.');
assert(!scrubbedText.includes('Private-PC'), 'Computer names must be redacted.');
assert(!scrubbedText.includes('192.168.1.44'), 'IP addresses must be redacted.');
assert(!scrubbedText.includes('AA:BB:CC:DD:EE:FF'), 'MAC addresses must be redacted.');
assert(!scrubbedText.includes('test@example.com'), 'Email addresses must be redacted.');
assert(!scrubbedText.includes('abc123'), 'Token values must be redacted.');

const sanitized = sanitizeSupportValue({
  web: JSON.stringify({ host: '127.0.0.1', authToken: 'private-token', enabled: true }),
  latencyHost: '1.1.1.1',
  sensorCustomNames: { cpu: 'Personal label' },
  safe: { enabled: true, count: 4 }
}, identity);
assert.strictEqual(sanitized.latencyHost, '[redacted]', 'Custom latency hosts must be redacted.');
assert.strictEqual(sanitized.sensorCustomNames, '[redacted]', 'Custom sensor names must be redacted.');
assert.strictEqual(sanitized.web.host, '[redacted]', 'Serialized host settings must be redacted.');
assert.strictEqual(sanitized.web.authToken, '[redacted]', 'Serialized auth tokens must be redacted.');
assert.deepStrictEqual(sanitized.safe, { enabled: true, count: 4 }, 'Non-sensitive support data must remain intact.');

const archive = createSupportZip({
  'manifest.json': '{"ok":true}\n',
  'diagnostics.txt': 'Diagnostic output\n'
}, new Date('2026-07-22T12:00:00Z'));
assert.strictEqual(archive.readUInt32LE(0), 0x04034B50, 'Support bundle must begin with a ZIP local-file header.');
assert(archive.includes(Buffer.from('manifest.json')), 'Support ZIP is missing its manifest.');
assert(archive.includes(Buffer.from('diagnostics.txt')), 'Support ZIP is missing diagnostic output.');
assert.strictEqual(archive.readUInt32LE(archive.length - 22), 0x06054B50, 'Support bundle must end with a valid ZIP directory record.');

console.log('Privacy-scrubbed support bundle checks passed.');
