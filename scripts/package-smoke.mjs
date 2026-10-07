import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const npmCli = process.env.npm_execpath;
assert(npmCli, 'Run this check with npm run test:package');
const temporary = mkdtempSync(join(tmpdir(), 'magicsword-mcp-package-'));

function npm(args, cwd = root) {
  // A parent npm exec --package must not select packages in the clean consumer.
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'npm_config_package') delete env[key];
  }
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `npm ${args[0]} failed: ${result.error ?? result.stderr}`);
  return result.stdout;
}

try {
  const [packed] = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', temporary]));
  const allowed = (path) => path.startsWith('dist/') || ['package.json', 'README.md', 'LICENSE'].includes(path);
  assert(packed.files.every((file) => allowed(file.path)), 'Package includes unexpected files');
  for (const required of ['dist/index.js', 'README.md', 'LICENSE', 'package.json']) {
    assert(packed.files.some((file) => file.path === required), `Package missing ${required}`);
  }
  const archive = join(temporary, packed.filename);
  const consumer = join(temporary, 'consumer');
  npm(['install', '--prefix', consumer, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', archive]);
  const installed = join(consumer, 'node_modules', ...pkg.name.split('/'));
  const installedPackage = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  assert.equal(installedPackage.version, pkg.version, 'Installed version differs from candidate');
  assert(!existsSync(join(consumer, 'node_modules', '@modelcontextprotocol', 'client')), 'Dev client was installed');
  const bin = join(consumer, 'node_modules', '.bin', `magicsword-mcp${process.platform === 'win32' ? '.cmd' : ''}`);
  assert(existsSync(bin), 'npm did not install the CLI bin');
  const version = npm(['exec', '--offline', '--no', '--', 'magicsword-mcp', '--version'], consumer);
  assert.equal(version.trim(), `magicsword-mcp ${pkg.version}`, 'Installed CLI version is incorrect');
  assert(npm(['exec', '--offline', '--no', '--', 'magicsword-mcp', '--help'], consumer).includes('Start the MCP server over stdio'));

  const entry = resolve(installed, installedPackage.bin['magicsword-mcp']);
  for (const mode of ['auto', 'legacy']) {
    const client = new Client({ name: 'package-smoke', version: '1.0.0' }, { versionNegotiation: { mode } });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      env: {
        ...process.env,
        MAGICSWORD_API_KEY: 'msk_test_package_1234567890',
        MAGICSWORD_BASE_URL: 'https://www.magicsword.io',
        MAGICSWORD_CONFIG: join(temporary, 'missing-config.json'),
      },
    });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      assert.equal(tools.length, 21, 'Installed MCP server must expose 21 tools');
      assert(tools.some((tool) => tool.name === 'whoami'), 'Installed MCP server missing whoami');
      assert.equal(tools.find((tool) => tool.name === 'flip_to_enforcing')?.annotations?.destructiveHint, true);
    } finally {
      await client.close();
    }
  }
  const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
  console.log(`Production package smoke passed (${process.platform}, Node ${process.versions.node}); ${packed.filename} sha256=${digest}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
