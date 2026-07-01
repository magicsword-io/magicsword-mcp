import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = process.cwd();
const bin = join(root, 'dist', 'index.js');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runNode(args, options = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
    input: options.input,
  });
}

function runCommand(command, args) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
  });
}

const help = runNode(['--help']);
assert(help.status === 0, `--help failed: ${help.stderr}`);
assert(help.stdout.includes('magicsword-mcp'), '--help did not print command name');

const version = runNode(['--version']);
assert(version.status === 0, `--version failed: ${version.stderr}`);
assert(/^magicsword-mcp \d+\.\d+\.\d+/.test(version.stdout), '--version did not print package version');

async function smokeMcpServer() {
  const client = new Client({ name: 'magicsword-mcp-smoke', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bin],
    env: {
      ...process.env,
      MAGICSWORD_API_KEY: 'msk_test_smoke_1234567890',
      MAGICSWORD_BASE_URL: 'https://www.magicsword.io',
      MAGICSWORD_CONFIG: join(tmpdir(), 'magicsword-mcp-smoke-missing-config.json'),
    },
  });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    const toolNames = listed.tools.map((tool) => tool.name);
    for (const required of [
      'whoami',
      'list_customer_intel_feeds',
      'manage_customer_intel_feed',
      'upsert_customer_intel_items',
      'manage_policy_rules',
      'upgrade_endpoints',
    ]) {
      assert(toolNames.includes(required), `MCP server did not register required tool ${required}`);
    }
    assert(toolNames.length >= 19, `MCP server registered too few tools: ${toolNames.length}`);
  } finally {
    await client.close();
  }
}

await smokeMcpServer();

const tempDir = mkdtempSync(join(tmpdir(), 'magicsword-mcp-smoke-'));
const configPath = join(tempDir, 'mcp.json');
try {
  const invalid = runNode(['configure', '--non-interactive', '--api-key', 'msk_...'], {
    env: { MAGICSWORD_CONFIG: configPath },
  });
  assert(invalid.status === 2, 'configure accepted placeholder API key msk_...');
  assert(!existsSync(configPath), 'configure wrote config for placeholder API key');

  const fakeKey = 'msk_test_smoke_1234567890';
  const valid = runNode(
    ['configure', '--non-interactive', '--api-key', fakeKey, '--base-url', 'https://www.magicsword.io'],
    { env: { MAGICSWORD_CONFIG: configPath } },
  );
  assert(valid.status === 0, `configure failed: ${valid.stderr}`);
  assert(!valid.stdout.includes(fakeKey), 'configure printed the API key in stdout');
  assert(valid.stdout.includes('"command": "magicsword-mcp"'), 'configure did not print Claude Desktop command snippet');

  const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
  assert(cfg.apiKey === fakeKey, 'configure did not persist the API key to MAGICSWORD_CONFIG');
  assert(cfg.baseUrl === 'https://www.magicsword.io', 'configure did not persist the base URL');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

const pack = runCommand('npm', ['pack', '--dry-run', '--ignore-scripts', '--json']);
assert(pack.status === 0, `npm pack --dry-run failed: ${pack.stderr}`);
const packed = JSON.parse(pack.stdout)[0];
const files = new Set(packed.files.map((file) => file.path));
assert(files.has('dist/index.js'), 'npm pack is missing dist/index.js');
assert(files.has('README.md'), 'npm pack is missing README.md');
assert(files.has('LICENSE'), 'npm pack is missing LICENSE');
assert(![...files].some((file) => file.startsWith('node_modules/')), 'npm pack includes node_modules');

console.log('MCP smoke checks passed');
