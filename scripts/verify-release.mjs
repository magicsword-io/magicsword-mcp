import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function verifyRelease({ pkg, lock, server, tag = `v${pkg.version}` }) {
  assert.equal(pkg.name, '@magicsword-io/magicsword-mcp', 'Unexpected npm package name');
  assert.equal(pkg.mcpName, 'io.github.magicsword-io/magicsword-mcp', 'Unexpected MCP name');
  assert.equal(server.name, pkg.mcpName, 'MCP Registry name must match package mcpName');
  assert.equal(tag, `v${pkg.version}`, 'Release tag must match npm package version');
  assert.equal(lock.name, pkg.name, 'Lockfile package name must match');
  assert.equal(lock.version, pkg.version, 'Lockfile version must match');
  assert.equal(lock.packages?.['']?.version, pkg.version, 'Lockfile root version must match');
  assert.equal(server.version, pkg.version, 'MCP Registry version must match');
  assert.equal(server.packages?.length, 1, 'Expected one Registry package');
  const registryPackage = server.packages[0];
  assert.equal(registryPackage.registryType, 'npm', 'Expected npm Registry package');
  assert.equal(registryPackage.identifier, pkg.name, 'Registry package identifier must match');
  assert.equal(registryPackage.version, pkg.version, 'Registry package reference version must match');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const readJson = (name) => JSON.parse(readFileSync(resolve(name), 'utf8'));
  try {
    verifyRelease({
      pkg: readJson('package.json'),
      lock: readJson('package-lock.json'),
      server: readJson('server.json'),
      tag: process.argv[2],
    });
    console.log('Release metadata checks passed');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
