import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

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

async function smokeMcpServer(mode) {
  const client = new Client(
    { name: `magicsword-mcp-smoke-${mode}`, version: '1.0.0' },
    { versionNegotiation: { mode } },
  );
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
    const protocolVersion = client.getNegotiatedProtocolVersion();
    if (mode === 'auto') {
      assert(protocolVersion === '2026-07-28', `modern MCP negotiation selected ${protocolVersion}`);
    } else {
      assert(protocolVersion !== '2026-07-28', 'legacy MCP negotiation unexpectedly selected the modern protocol');
    }
    const listed = await client.listTools();
    const toolNames = listed.tools.map((tool) => tool.name);
    for (const required of [
      'whoami',
      'list_customer_intel_feeds',
      'manage_customer_intel_feed',
      'upsert_customer_intel_items',
      'manage_policy_rules',
      'upgrade_endpoints',
      'show_endpoint',
      'list_agent_releases',
    ]) {
      assert(toolNames.includes(required), `MCP server did not register required tool ${required}`);
    }
    assert(toolNames.length === 21, `MCP server registered the wrong number of tools: ${toolNames.length}`);
    const listEndpoints = listed.tools.find((tool) => tool.name === 'list_endpoints');
    const flipToEnforcing = listed.tools.find((tool) => tool.name === 'flip_to_enforcing');
    assert(listEndpoints?.annotations?.readOnlyHint === true, 'list_endpoints is not marked read-only');
    assert(flipToEnforcing?.annotations?.readOnlyHint === false, 'flip_to_enforcing is incorrectly marked read-only');
    assert(flipToEnforcing?.annotations?.destructiveHint === true, 'flip_to_enforcing is not marked destructive');
  } finally {
    await client.close();
  }
}

await smokeMcpServer('auto');
await smokeMcpServer('legacy');

async function smokeToolHandlers() {
  const [
    { listPoliciesTool },
    { showPolicyTool },
    { flipToEnforcingTool },
    { managePolicyRulesTool },
    { findAlertsTool },
    { triageAlertTool },
    { listEndpointsTool },
    { listEventsTool },
    { applyPolicyToEndpointsTool },
    { upgradeEndpointsTool },
    { manageCustomerIntelFeedTool },
    { manageCustomerIntelItemTool },
  ] = await Promise.all([
    import(pathToFileURL(join(root, 'dist', 'tools', 'list_policies.js')).href),
    import(pathToFileURL(join(root, 'dist', 'tools', 'show_policy.js')).href),
    import(pathToFileURL(join(root, 'dist', 'tools', 'flip_to_enforcing.js')).href),
    import(pathToFileURL(join(root, 'dist', 'tools', 'manage_policy_rules.js')).href),
    import(pathToFileURL(join(root, 'dist', 'tools', 'find_alerts.js')).href),
    import(pathToFileURL(join(root, 'dist', 'tools', 'triage_alert.js')).href),
    import(pathToFileURL(join(root, 'dist', 'tools', 'list_endpoints.js')).href),
    import(pathToFileURL(join(root, 'dist', 'tools', 'list_events.js')).href),
    import(pathToFileURL(join(root, 'dist', 'tools', 'apply_policy_to_endpoints.js')).href),
    import(pathToFileURL(join(root, 'dist', 'tools', 'upgrade_endpoints.js')).href),
    import(pathToFileURL(join(root, 'dist', 'tools', 'manage_customer_intel_feed.js')).href),
    import(pathToFileURL(join(root, 'dist', 'tools', 'manage_customer_intel_item.js')).href),
  ]);

  const policy = {
    id: '00000000-0000-4000-8000-000000000101',
    platform: 'windows',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    current_version: {
      id: '00000000-0000-4000-8000-000000000102',
      name: 'Workstations',
      version: 7,
      status: 'audit',
      policy_mode: 'blocklist',
      updated_at: '2026-01-02T00:00:00Z',
      change_message: 'smoke',
    },
  };
  const calls = [];
  const endpointId = '00000000-0000-4000-8000-000000000201';
  const alertId = '00000000-0000-4000-8000-000000000301';
  const eventId = '00000000-0000-4000-8000-000000000401';
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
        confirmation: {
          token: 'confirm-smoke-token',
          expires_at: '2026-01-02T00:05:00Z',
        },
      };
    },
    async enforcePolicy(policyId, token) {
      calls.push(['enforcePolicy', policyId, token]);
      return { policy_id: policyId, status: 'enforcing' };
    },
    async addPolicyRules(body) {
      calls.push(['addPolicyRules', body]);
      return {
        added_count: body.event_ids?.length ?? body.rules?.length ?? 0,
        version: 8,
      };
    },
    async policyRules(policyId) {
      calls.push(['policyRules', policyId]);
      return { policy_id: policyId, rules: [], total: 0 };
    },
    async alerts(query) {
      calls.push(['alerts', query]);
      return {
        alerts: [
          {
            id: alertId,
            severity: 'critical',
            title: 'Smoke alert',
            endpoint_name: 'prod-win-01',
            mitre_techniques: ['T1059.001'],
            created_at: '2026-01-02T00:00:00Z',
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
      };
    },
    async alert(requestedAlertId) {
      calls.push(['alert', requestedAlertId]);
      return {
        alert: {
          id: requestedAlertId,
          severity: 'critical',
          title: 'Smoke alert',
          endpoint_name: 'prod-win-01',
          triggering_events: [{ id: 'trigger-1' }],
          metadata: { source: 'smoke' },
          created_at: '2026-01-02T00:00:00Z',
        },
      };
    },
    async endpoints(query) {
      calls.push(['endpoints', query]);
      return {
        endpoints: [
          {
            id: endpointId,
            computer_name: 'prod-win-01',
            platform: 'windows',
            status: 'active',
            compliance_status: 'compliant',
            installer_version: '1.2.3',
            policy_id: policy.id,
            last_checkin: '2026-01-02T00:00:00Z',
            last_heartbeat: null,
            created_at: '2026-01-01T00:00:00Z',
            uninstalled_at: null,
            update_status: 'idle',
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
      };
    },
    async events(query) {
      calls.push(['events', query]);
      return {
        events: [
          {
            id: eventId,
            type: 'browser_extension',
            status: 'audited',
            platform: 'windows',
            name: 'Security Helper',
            created_at: '2026-01-02T00:00:00Z',
            rule_context: {
              browser_extension: {
                id: 'abcdefghijklmnop',
                browser: 'chrome',
              },
            },
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
        since: '2026-01-01T00:00:00Z',
      };
    },
    async assignPolicyToEndpoints(policyId, endpointIds) {
      calls.push(['assignPolicyToEndpoints', policyId, endpointIds]);
      return { assigned: endpointIds.length };
    },
    async upgradeEndpoint(requestedEndpointId, targetVersion) {
      calls.push(['upgradeEndpoint', requestedEndpointId, targetVersion]);
      return { queued: true };
    },
    async deleteIntelFeed(feedId) {
      calls.push(['deleteIntelFeed', feedId]);
      return { deleted: true };
    },
    async deleteIntelFeedItem(feedId, itemId) {
      calls.push(['deleteIntelFeedItem', feedId, itemId]);
      return { deleted: true };
    },
  };

  const listed = await listPoliciesTool.handler({}, { client: fakeClient });
  assert(listed.content[0].text.includes('status: audit'), 'list_policies output omitted enforcement status');
  assert(listed.content[0].text.includes('policy_mode: blocklist'), 'list_policies output omitted policy mode');

  const shown = await showPolicyTool.handler({ policy_id: policy.id }, { client: fakeClient });
  assert(shown.content[0].text.includes('Status: audit'), 'show_policy output omitted enforcement status');
  assert(shown.content[0].text.includes('Policy mode: blocklist'), 'show_policy output omitted policy mode');

  const preview = await flipToEnforcingTool.handler({ policy_id: policy.id }, { client: fakeClient });
  assert(
    preview.content[0].text.includes('confirmation_token="confirm-smoke-token"'),
    'flip_to_enforcing preview omitted confirmation token',
  );

  const commit = await flipToEnforcingTool.handler(
    { policy_id: policy.id, confirmation_token: 'confirm-smoke-token' },
    { client: fakeClient },
  );
  assert(
    commit.content[0].text.includes('was flipped to enforcing'),
    'flip_to_enforcing commit did not report success',
  );
  assert(
    calls.some((call) => call[0] === 'enforcePolicy' && call[2] === 'confirm-smoke-token'),
    'flip_to_enforcing did not commit with the supplied token',
  );

  assert(
    managePolicyRulesTool.description.includes('Do not add explicit flat file-hash rules for Windows WDAC'),
    'manage_policy_rules description does not warn about Windows flat hash rules',
  );
  const addRules = await managePolicyRulesTool.handler(
    {
      action: 'add',
      policy_name: 'Workstations',
      event_ids: ['00000000-0000-4000-8000-000000000103'],
      status: 'allowed',
    },
    { client: fakeClient },
  );
  assert(
    addRules.content[0].text.includes('Updated policy rules'),
    'manage_policy_rules add handler did not report success',
  );
  assert(
    calls.some(
      (call) => call[0] === 'addPolicyRules' && call[1].event_ids?.[0] === '00000000-0000-4000-8000-000000000103',
    ),
    'manage_policy_rules add handler did not pass event_ids to the API client',
  );

  const events = await listEventsTool.handler(
    { hours: 24, status: 'audited' },
    { client: fakeClient },
  );
  assert(events.structuredContent?.events?.[0]?.id === eventId, 'list_events omitted the event id');
  assert(
    events.structuredContent?.events?.[0]?.rule_context?.browser_extension?.id === 'abcdefghijklmnop',
    'list_events omitted normalized rule context',
  );
  await managePolicyRulesTool.handler(
    {
      action: 'add',
      policy_name: 'Workstations',
      event_ids: [eventId],
      status: 'allowed',
    },
    { client: fakeClient },
  );
  assert(
    calls.some(
      (call) => call[0] === 'addPolicyRules' && call[1].event_ids?.[0] === eventId,
    ),
    'list_events to manage_policy_rules workflow did not preserve the selected event id',
  );

  await findAlertsTool.handler({ hostname: 'prod-*', mitre_technique: 'T1059.001' }, { client: fakeClient });
  assert(
    calls.some(
      (call) =>
        call[0] === 'alerts' && call[1].hostname_pattern === 'prod-*' && call[1].mitre_technique === 'T1059.001',
    ),
    'find_alerts did not pass server-side hostname and MITRE filters',
  );

  const triaged = await triageAlertTool.handler({ alert_id: alertId }, { client: fakeClient });
  assert(triaged.content[0].text.includes('Triggering events'), 'triage_alert omitted triggering events');
  assert(
    calls.some((call) => call[0] === 'alert' && call[1] === alertId),
    'triage_alert did not use direct alert lookup',
  );

  await listEndpointsTool.handler({ hostname_pattern: 'prod-*' }, { client: fakeClient });
  assert(
    calls.some((call) => call[0] === 'endpoints' && call[1].hostname_pattern === 'prod-*'),
    'list_endpoints did not pass the server-side hostname filter',
  );

  const policyPreview = await applyPolicyToEndpointsTool.handler(
    { policy_id: policy.id, endpoint_ids: [endpointId] },
    { client: fakeClient },
  );
  assert(policyPreview.content[0].text.includes('PREVIEW'), 'policy assignment did not preview before mutation');
  assert(
    !calls.some((call) => call[0] === 'assignPolicyToEndpoints'),
    'policy assignment mutated without confirm=true',
  );
  await applyPolicyToEndpointsTool.handler(
    { policy_id: policy.id, endpoint_ids: [endpointId], confirm: true },
    { client: fakeClient },
  );
  assert(
    calls.some((call) => call[0] === 'assignPolicyToEndpoints'),
    'policy assignment did not mutate with confirm=true',
  );

  const upgradePreview = await upgradeEndpointsTool.handler(
    { endpoint_id: endpointId },
    { client: fakeClient },
  );
  assert(upgradePreview.content[0].text.includes('PREVIEW'), 'endpoint upgrade did not preview before mutation');
  assert(!calls.some((call) => call[0] === 'upgradeEndpoint'), 'endpoint upgrade mutated without confirm=true');
  await upgradeEndpointsTool.handler(
    { endpoint_id: endpointId, confirm: true },
    { client: fakeClient },
  );
  assert(calls.some((call) => call[0] === 'upgradeEndpoint'), 'endpoint upgrade did not mutate with confirm=true');

  const feedId = '00000000-0000-4000-8000-000000000501';
  const itemId = '00000000-0000-4000-8000-000000000502';
  await manageCustomerIntelFeedTool.handler({ action: 'delete', feed_id: feedId }, { client: fakeClient });
  assert(!calls.some((call) => call[0] === 'deleteIntelFeed'), 'feed deletion mutated without confirm=true');
  await manageCustomerIntelFeedTool.handler(
    { action: 'delete', feed_id: feedId, confirm: true },
    { client: fakeClient },
  );
  assert(calls.some((call) => call[0] === 'deleteIntelFeed'), 'feed deletion did not mutate with confirm=true');

  await manageCustomerIntelItemTool.handler(
    { action: 'delete', feed_id: feedId, item_id: itemId },
    { client: fakeClient },
  );
  assert(!calls.some((call) => call[0] === 'deleteIntelFeedItem'), 'item deletion mutated without confirm=true');
  await manageCustomerIntelItemTool.handler(
    { action: 'delete', feed_id: feedId, item_id: itemId, confirm: true },
    { client: fakeClient },
  );
  assert(calls.some((call) => call[0] === 'deleteIntelFeedItem'), 'item deletion did not mutate with confirm=true');
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

  const unsafeUrl = runNode(
    ['configure', '--non-interactive', '--api-key', 'msk_test_smoke_1234567890', '--base-url', 'http://example.com'],
    { env: { MAGICSWORD_CONFIG: configPath } },
  );
  assert(unsafeUrl.status === 2, 'configure accepted a non-local HTTP base URL');
  assert(!existsSync(configPath), 'configure wrote config for an unsafe base URL');

  const fakeKey = 'msk_test_smoke_1234567890';
  const valid = runNode(
    ['configure', '--non-interactive', '--api-key', fakeKey, '--base-url', 'https://www.magicsword.io'],
    { env: { MAGICSWORD_CONFIG: configPath } },
  );
  assert(valid.status === 0, `configure failed: ${valid.stderr}`);
  assert(!valid.stdout.includes(fakeKey), 'configure printed the API key in stdout');
  assert(
    valid.stdout.includes(`"command": ${JSON.stringify(process.execPath)}`),
    'configure did not print an absolute Node command snippet',
  );

  const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
  assert(cfg.apiKey === fakeKey, 'configure did not persist the API key to MAGICSWORD_CONFIG');
  assert(cfg.baseUrl === 'https://www.magicsword.io', 'configure did not persist the base URL');
  if (process.platform !== 'win32') {
    assert((statSync(configPath).mode & 0o777) === 0o600, 'configure did not restrict the API key file to mode 600');
  }
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
