const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const sensorReader = fs.readFileSync(path.join(root, 'sensorReader.js'), 'utf8');
const version = packageJson.version;

assert.strictEqual(version, '1.3.5', 'Package version was not promoted to 1.3.5.');
assert.strictEqual(packageLock.version, version, 'Lockfile version does not match package.json.');
assert.strictEqual(packageLock.packages?.['']?.version, version, 'Lockfile root package version does not match package.json.');
assert.strictEqual(packageJson.build?.directories?.output, `V${version}`, 'Build output folder does not match the app version.');
assert.strictEqual(packageJson.build?.portable?.artifactName, `SiR-System-Monitor-Portable-${version}.${'${ext}'}`, 'Portable artifact name is inconsistent.');
assert.strictEqual(packageJson.build?.nsis?.artifactName, `SiR-System-Monitor-Setup-${version}.${'${ext}'}`, 'Installer artifact name is inconsistent.');
assert((packageJson.build?.files || []).includes(`!V${version}/**`), 'The active output directory is not excluded from packaged input.');
assert(changelog.includes(`## ${version} - `), 'The changelog is missing the current version heading.');
assert(sensorReader.includes(`SiR-System-Monitor/${version}`), 'Sensor-host network identity is stale.');

console.log(`Version consistency checks passed for ${version}.`);
