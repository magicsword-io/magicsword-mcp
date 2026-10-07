import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifyRelease } from './verify-release.mjs';

function release() {
  const readJson = (name) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
  return { pkg: readJson('package.json'), lock: readJson('package-lock.json'), server: readJson('server.json') };
}

test('current release metadata is consistent', () => verifyRelease(release()));

test('rejects a tag for a different version', () => {
  assert.throws(() => verifyRelease({ ...release(), tag: 'v999.0.0' }), /Release tag/);
});

test('rejects a tag without the v prefix', () => {
  const data = release();
  assert.throws(() => verifyRelease({ ...data, tag: data.pkg.version }), /Release tag/);
});

test('rejects stale npm references even if the top-level Registry version matches', () => {
  const data = release();
  data.server.packages[0].version = '999.0.0';
  assert.throws(() => verifyRelease(data), /Registry package reference version/);
});

for (const [name, mutate, message] of [
  ['Registry version', (data) => { data.server.version = '999.0.0'; }, /Registry version/],
  ['lockfile version', (data) => { data.lock.version = '999.0.0'; }, /Lockfile version/],
  ['lockfile root version', (data) => { data.lock.packages[''].version = '999.0.0'; }, /Lockfile root version/],
  ['Registry name', (data) => { data.server.name = 'io.github.other/server'; }, /Registry name/],
  ['npm identifier', (data) => { data.server.packages[0].identifier = '@other/server'; }, /identifier/],
  ['missing npm package', (data) => { data.server.packages = []; }, /one Registry package/],
  ['extra package reference', (data) => { data.server.packages.push({ ...data.server.packages[0] }); }, /one Registry package/],
]) {
  test(`rejects mismatched ${name}`, () => {
    const data = release();
    mutate(data);
    assert.throws(() => verifyRelease(data), message);
  });
}

test('allows a synchronized prerelease bootstrap', () => {
  const data = release();
  data.pkg.version = data.lock.version = data.lock.packages[''].version =
    data.server.version = data.server.packages[0].version = '0.1.0-beta.0';
  verifyRelease(data);
});

test('npm version synchronizes Registry metadata through beta bootstrap and stable release', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'mcp-version-hook-'));
  const npmCli = process.env.npm_execpath;
  assert(npmCli, 'Run lifecycle regression checks with npm test');
  const readJson = (name) => JSON.parse(readFileSync(join(temporary, name), 'utf8'));
  const writeJson = (name, data) => writeFileSync(join(temporary, name), `${JSON.stringify(data, null, 2)}\n`);
  const runNpm = (args) => {
    const result = spawnSync(process.execPath, [npmCli, ...args], {
      cwd: temporary,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, npm_config_ignore_scripts: 'false' },
    });
    assert.equal(result.status, 0, `npm ${args.join(' ')} failed: ${result.error ?? result.stderr}`);
  };
  const fixture = release();
  fixture.pkg.version = fixture.lock.version = fixture.lock.packages[''].version =
    fixture.server.version = fixture.server.packages[0].version = '0.1.0';
  try {
    writeJson('package.json', fixture.pkg);
    writeJson('package-lock.json', fixture.lock);
    writeJson('server.json', fixture.server);
    mkdirSync(join(temporary, 'scripts'));
    for (const name of ['sync-registry-version.mjs', 'verify-release.mjs']) {
      copyFileSync(new URL(name, import.meta.url), join(temporary, 'scripts', name));
    }
    runNpm(['version', '0.1.0-beta.0', '--no-git-tag-version']);
    assert.equal(readJson('server.json').version, '0.1.0-beta.0');
    verifyRelease({ pkg: readJson('package.json'), lock: readJson('package-lock.json'), server: readJson('server.json') });

    // Recover the exact interrupted/manual bootstrap state reported by the user.
    writeJson('server.json', fixture.server);
    const packageBefore = readFileSync(join(temporary, 'package.json'), 'utf8');
    runNpm(['run', 'release:sync']);
    assert.equal(readFileSync(join(temporary, 'package.json'), 'utf8'), packageBefore);
    assert.equal(readJson('server.json').version, '0.1.0-beta.0');

    runNpm(['version', '0.1.0', '--no-git-tag-version']);
    verifyRelease({ pkg: readJson('package.json'), lock: readJson('package-lock.json'), server: readJson('server.json') });

    // A sync must not hide incorrect ownership or an inconsistent lockfile.
    for (const corrupt of [
      () => { const server = readJson('server.json'); server.packages[0].identifier = '@other/server'; writeJson('server.json', server); },
      () => { writeJson('server.json', fixture.server); const lock = readJson('package-lock.json'); lock.version = '999.0.0'; writeJson('package-lock.json', lock); },
    ]) {
      corrupt();
      const before = readFileSync(join(temporary, 'server.json'), 'utf8');
      const result = spawnSync(process.execPath, [join(temporary, 'scripts', 'sync-registry-version.mjs')], { cwd: temporary, encoding: 'utf8' });
      assert.notEqual(result.status, 0, 'Sync accepted inconsistent metadata');
      assert.equal(readFileSync(join(temporary, 'server.json'), 'utf8'), before, 'Failed sync changed Registry metadata');
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
