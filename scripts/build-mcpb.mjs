import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { zipSync } from 'fflate';
import { verifyRelease } from './verify-release.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = name => JSON.parse(readFileSync(join(root, name), 'utf8'));

export async function buildMcpb(outputDirectory = join(root, 'release-assets')) {
  const pkg = readJson('package.json');
  const manifest = readJson('manifest.json');
  const lock = readJson('package-lock.json');
  verifyRelease({ pkg, lock, server: readJson('server.json'), manifest });
  for (const [name, dependency] of Object.entries(lock.packages)) {
    if (!name || dependency.dev) continue;
    assert(!dependency.os && !dependency.cpu && !dependency.libc && !dependency.hasInstallScript, `Desktop bundle needs platform review: ${name}`);
  }
  const npmCli = process.env.npm_execpath;
  assert(npmCli, 'Build with npm run bundle:desktop');
  const validator = new Ajv({ allErrors: true });
  addFormats(validator);
  const valid = validator.compile(readJson('scripts/vendor/mcpb/manifest-v0.3.schema.json'));
  assert(valid(manifest), `Invalid MCPB manifest: ${validator.errorsText(valid.errors)}`);
  const temporary = mkdtempSync(join(tmpdir(), 'magicsword-mcp-bundle-'));
  const output = resolve(outputDirectory);
  mkdirSync(output, { recursive: true });
  const archive = join(output, 'magicsword-mcp.mcpb');

  function run(args, cwd = root) {
    const result = spawnSync(process.execPath, args, {
      cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(result.status, 0, `Bundle command failed: ${result.error?.message || result.stderr || result.stdout || `exit ${result.status}`}`);
  }

  try {
    // Build only from this allow-list, never by archiving the working checkout.
    // Production dependencies are installed from the lockfile without lifecycle
    // scripts. No developer config, environment files, or credentials are copied.
    for (const name of ['dist', 'assets', 'README.md', 'LICENSE', 'package.json', 'package-lock.json']) {
      cpSync(join(root, name), join(temporary, name), { recursive: true });
    }
    run([npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], temporary);
    rmSync(join(temporary, 'package-lock.json'));
    const { name, version, type, description, license, engines, dependencies } = pkg;
    writeFileSync(join(temporary, 'package.json'), `${JSON.stringify({ name, version, type, description, license, engines, dependencies }, null, 2)}\n`);
    writeFileSync(join(temporary, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    // MCPB is a ZIP containing manifest.json, the server, and dependencies.
    // Fixed ordering and timestamps make the archive reproducible.
    const entries = {};
    function collect(directory, prefix = '') {
      for (const name of readdirSync(directory).sort()) {
        if (name === '.bin') continue; // npm's CLI symlinks are not used by this server.
        assert(!/^\.env(?:\.|$)|^(?:mcp|credentials)\.json$/i.test(name), 'Refusing to bundle a credential file');
        const path = join(directory, name);
        const relative = prefix ? `${prefix}/${name}` : name;
        assert(!/\.(?:node|dll|so|dylib|exe)$/i.test(name), `Desktop bundle contains native code: ${relative}`);
        const stat = lstatSync(path);
        assert(!stat.isSymbolicLink(), `Unexpected symlink in bundle: ${relative}`);
        if (stat.isDirectory()) collect(path, relative);
        else {
          assert(stat.isFile(), `Unsupported bundle entry: ${relative}`);
          entries[relative] = [new Uint8Array(readFileSync(path)), { attrs: 0o100644 * 65536 }];
        }
      }
    }
    collect(temporary);
    writeFileSync(archive, zipSync(entries, { level: 9, mtime: new Date(1980, 0, 1) }));
    const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
    writeFileSync(`${archive}.sha256`, `${digest}  magicsword-mcp.mcpb\n`);
    console.log(`Desktop installer built: ${archive} (version ${version}, sha256=${digest})`);
    return archive;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildMcpb(process.argv[2]);
}
