const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const terms = fs.readFileSync(path.join(root, 'TERMS_OF_SERVICE.md'), 'utf8');
const privacy = fs.readFileSync(path.join(root, 'PRIVACY_POLICY.md'), 'utf8');

assert.match(mainSource, /let discordSessionStartedAt = 0;/, 'Discord session start should be stable for one presence session');
assert.match(mainSource, /timestamps:\s*\{\s*start: discordSessionStartedAt\s*\}/s, 'Presence should use Discord RPC timestamp fields');
assert.match(mainSource, /assets:\s*\{[\s\S]*large_image:\s*'sir_sm_circle'/, 'Presence should use Discord RPC asset fields');
assert.match(mainSource, /large_text:\s*'SiR System Monitor'/, 'Presence artwork should use the product name');
assert.doesNotMatch(mainSource, /partyMax|party_max|joinSecret|join_secret|Numbani/, 'Presence must not advertise a fake party or unrelated artwork');
assert.match(terms, /does not give the maintainer an active-user list or global “player” count/i);
assert.match(privacy, /no user account system, advertising, or maintainer-operated telemetry service/i);
assert.match(privacy, /api\.ipify\.org/);
assert.match(privacy, /jsDelivr/i);

console.log('Discord integration and public policy checks passed.');
