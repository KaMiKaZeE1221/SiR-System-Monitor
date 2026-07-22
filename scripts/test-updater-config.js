const assert = require('assert');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const workspaceRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8'));
const updateConfigPath = path.join(workspaceRoot, 'build', 'app-update.yml');
const mainSource = fs.readFileSync(path.join(workspaceRoot, 'main.js'), 'utf8');
const updateConfig = yaml.load(fs.readFileSync(updateConfigPath, 'utf8'));

assert.deepStrictEqual(updateConfig, {
  owner: 'KaMiKaZeE1221',
  repo: 'SiR-System-Monitor',
  provider: 'github',
  updaterCacheDirName: 'sir-system-monitor-updater'
}, 'The packaged updater configuration is incorrect.');

const updaterResource = (packageJson.build?.extraResources || []).find((entry) => entry?.to === 'app-update.yml');
assert(updaterResource, 'app-update.yml is not included as an extra resource.');
assert.strictEqual(updaterResource.from, 'build/app-update.yml', 'The updater resource points to the wrong source file.');
assert(mainSource.includes('configureAutoUpdaterFeed();'), 'The runtime updater fallback is not initialized.');
assert(mainSource.includes("app-update-fallback.yml"), 'The writable runtime updater fallback is missing.');
assert(mainSource.includes('autoUpdater.setFeedURL(AUTO_UPDATE_PROVIDER)'), 'The direct GitHub feed fallback is missing.');

console.log(JSON.stringify({
  provider: updateConfig.provider,
  owner: updateConfig.owner,
  repo: updateConfig.repo,
  packagedResource: updaterResource.to,
  runtimeFallback: true
}, null, 2));
