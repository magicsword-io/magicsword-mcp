import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { verifyRelease } from './verify-release.mjs';

const readJson = (name) => JSON.parse(readFileSync(name, 'utf8'));
const pkg = readJson('package.json');
const lock = readJson('package-lock.json');
const server = readJson('server.json');
const manifest = readJson('manifest.json');

assert.equal(server.packages?.length, 1, 'Expected one Registry package');
assert.equal(server.packages[0].registryType, 'npm', 'Expected npm Registry package');
assert.equal(server.packages[0].identifier, pkg.name, 'Registry package identifier must match');

const synchronized = {
  ...server,
  version: pkg.version,
  packages: [{ ...server.packages[0], version: pkg.version }],
};
const synchronizedManifest = { ...manifest, version: pkg.version };
verifyRelease({ pkg, lock, server: synchronized, manifest: synchronizedManifest });
writeFileSync('server.json', `${JSON.stringify(synchronized, null, 2)}\n`);
writeFileSync('manifest.json', `${JSON.stringify(synchronizedManifest, null, 2)}\n`);
console.log(`Registry and desktop metadata synchronized to ${pkg.version}`);
