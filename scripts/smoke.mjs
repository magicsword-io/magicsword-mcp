import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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

async function smokeToolHandlers() {
  const [
    { listPoliciesTool },
    { showPolicyTool },
    { flipToEnforcingTool },
    { managePolicyRulesTool },
  ] = await Promise.all([
    import(pathToFileURL(join(root, 'dist', 'tools', 'list_policies.js')).href),
    import(pathToFileURL(join(root, 'dist', 'tools', 'show_policy.js')).href),
    import(pathToFileURL(join(root, 'dist', 'tools', 'flip_to_enforcing.js')).href),
    import(pathToFileURL(join(root, 'dist', 'tools', 'manage_policy_rules.js')).href),
  ]);

  const policy = {
    id: 'pol-smoke-1',
    platform: 'windows',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    current_version: {
      id: 'ver-smoke-1',
      name: 'Workstations',
      version: 7,
      status: 'audit',
      policy_mode: 'blocklist',
      updated_at: '2026-01-02T00:00:00Z',
      change_message: 'smoke',
    },
  };
  const calls = [];
  const fakeClient = {
    async policies() {
      return { policies: [policy] };
    },
    async policy(policyId) {
      assert(policyId === policy.id, 'show_policy sent wrong policy id');
      return { policy };
    },
    async enforcePreview(policyId, acknowledgeBlockers) {
      calls.push(['enforcePreview', policyId, acknowledgeBlockers]);
      return {
        can_enforce: true,
        preflight: { endpoint_count: 2 },
        readiness: { readinessScore: 98, pending: 0, escalated: 0 },
        blockers: [],
        confirmation: { token: 'confirm-smoke-token', expires_at: '2026-01-02T00:05:00Z' },
      };
    },
    async enforcePolicy(policyId, token) {
      calls.push(['enforcePolicy', policyId, token]);
      return { policy_id: policyId, status: 'enforcing' };
    },
    async addPolicyRules(body) {
      calls.push(['addPolicyRules', body]);
      return { added_count: body.event_ids?.length ?? body.rules?.length ?? 0, version: 8 };
    },
    async policyRules(policyId) {
      calls.push(['policyRules', policyId]);
      return { policy_id: policyId, rules: [], total: 0 };
    },
  };

  const listed = await listPoliciesTool.handler({}, { client: fakeClient });
  assert(listed.content[0].text.includes('status: audit'), 'list_policies output omitted enforcement status');
  assert(listed.content[0].text.includes('policy_mode: blocklist'), 'list_policies output omitted policy mode');

  const shown = await showPolicyTool.handler({ policy_id: policy.id }, { client: fakeClient });
  assert(shown.content[0].text.includes('Status: audit'), 'show_policy output omitted enforcement status');
  assert(shown.content[0].text.includes('Policy mode: blocklist'), 'show_policy output omitted policy mode');

  const preview = await flipToEnforcingTool.handler({ policy_id: policy.id }, { client: fakeClient });
  assert(preview.content[0].text.includes('confirmation_token="confirm-smoke-token"'), 'flip_to_enforcing preview omitted confirmation token');

  const commit = await flipToEnforcingTool.handler(
    { policy_id: policy.id, confirmation_token: 'confirm-smoke-token' },
    { client: fakeClient },
  );
  assert(commit.content[0].text.includes('was flipped to enforcing'), 'flip_to_enforcing commit did not report success');
  assert(
    calls.some((call) => call[0] === 'enforcePolicy' && call[2] === 'confirm-smoke-token'),
    'flip_to_enforcing did not commit with the supplied token',
  );

  assert(
    managePolicyRulesTool.description.includes('Do not add explicit flat file-hash rules for Windows WDAC'),
    'manage_policy_rules description does not warn about Windows flat hash rules',
  );
  const addRules = await managePolicyRulesTool.handler(
    { action: 'add', policy_name: 'Workstations', event_ids: ['evt-1'], status: 'allowed' },
    { client: fakeClient },
  );
  assert(addRules.content[0].text.includes('Updated policy rules'), 'manage_policy_rules add handler did not report success');
  assert(
    calls.some((call) => call[0] === 'addPolicyRules' && call[1].event_ids?.[0] === 'evt-1'),
    'manage_policy_rules add handler did not pass event_ids to the API client',
  );
}

await smokeToolHandlers();

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
