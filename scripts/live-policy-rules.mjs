// Opt-in integration test. Supply a disposable, unassigned Windows audit policy.
// Prints only assertion names/counts; never credentials or customer responses.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { loadConfig } from '../dist/config.js';

if (process.env.MAGICSWORD_LIVE_TEST !== '1' || !process.env.MAGICSWORD_TEST_POLICY_ID) {
  throw new Error('Set MAGICSWORD_LIVE_TEST=1 and MAGICSWORD_TEST_POLICY_ID to a disposable, unassigned Windows audit policy.');
}
const policy_id = process.env.MAGICSWORD_TEST_POLICY_ID;
const config = loadConfig();
const client = new Client({ name: 'magicsword-live-policy-rules', version: '1.0.0' }, {
  versionNegotiation: { mode: process.env.MAGICSWORD_TEST_PROTOCOL === 'legacy' ? 'legacy' : 'auto' },
});
const transport = new StdioClientTransport({
  command: process.execPath, args: [join(process.cwd(), 'dist/index.js')],
  env: { ...process.env, MAGICSWORD_API_KEY: config.apiKey, MAGICSWORD_BASE_URL: config.baseUrl,
    MAGICSWORD_CONFIG: join(tmpdir(), 'magicsword-live-missing.json') },
  stderr: 'pipe',
});
let assertions = 0;
function check(condition, label) {
  assert.ok(condition, label);
  assertions++;
  console.log(`PASS ${label}`);
}
async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  assert.ok(!result.isError, `${name} failed (response withheld)`);
  return result.structuredContent;
}
async function listRules() {
  const rows = [];
  let total;
  for (let offset = 0; ; offset += 500) {
    const page = await call('manage_policy_rules', { action: 'list', policy_id, limit: 500, offset });
    total ??= page.total;
    assert.equal(page.total, total, 'Rules changed during pagination');
    rows.push(...page.rules);
    if (rows.length >= total) break;
    assert.ok(page.rules.length > 0, 'Pagination stopped before total');
  }
  assert.equal(rows.length, total);
  return rows;
}
function ruleKey(rule) { return JSON.stringify([rule.type, rule.value, rule.source]); }
function baselinePreserved(before, after) {
  const byKey = new Map(after.map(rule => [ruleKey(rule), rule]));
  return before.every(rule => {
    const current = byKey.get(ruleKey(rule));
    return current && ['name', 'status', 'mode', 'min_version', 'max_version', 'package_version', 'target_platforms']
      .every(key => JSON.stringify(current[key]) === JSON.stringify(rule[key]));
  });
}
try {
  await client.connect(transport);
  const discovery = await client.listTools();
  check(discovery.tools.length === 23, '23 tools discovered over stdio');
  const me = await call('whoami');
  check(['policies:read', 'policies:write'].every(scope => me.scopes.includes(scope)), 'authenticated policy read/write scopes');
  const policy = await call('show_policy', { policy_id });
  check(policy.platform === 'windows' && policy.current_version?.status === 'audit', 'fixture is a Windows audit policy');
  check(policy.current_version.name.startsWith('MCP issue 5 disposable verification'), 'fixture has the disposable test name');
  let endpoint;
  for (let offset = 0; ; offset += 500) {
    const page = await call('list_endpoints', { limit: 500, offset });
    endpoint ??= page.endpoints[0];
    check(page.endpoints.every(e => e.policy_id !== policy_id && e.macos_policy_id !== policy_id && !e.desired_policy_ids?.includes(policy_id)), 'fixture is unassigned on endpoint page');
    if (offset + page.endpoints.length >= page.total) break;
    assert.ok(page.endpoints.length > 0);
  }
  if (endpoint) await call('show_endpoint', { endpoint_id: endpoint.id });
  await call('list_policies', { platform: 'windows' });
  await call('list_agent_releases', { platform: 'windows', latest: true });
  const alerts = await call('find_alerts', { limit: 1 });
  if (alerts.alerts[0]) await call('triage_alert', { alert_id: alerts.alerts[0].id });
  const feeds = await call('list_customer_intel_feeds', { limit: 1 });
  if (feeds.feeds[0]) await call('list_customer_intel_feeds', { feed_id: feeds.feeds[0].id, limit: 1 });
  const events = await call('list_events', { hours: 744, platform: 'windows', limit: 100 });
  check(true, 'read tools return valid live responses');
  const baseline = await listRules();
  check(baseline.length > 1000, 'baseline pagination includes more than 1000 rules');
  const sourcesBefore = await call('manage_policy_intel_sources', { action: 'list', policy_id });
  const rules = ['rustdesk.exe', 'mshta.exe', 'wscript.exe'].map(value => ({ type: 'filename', value, status: 'blocked' }));
  const added = await call('manage_policy_rules', { action: 'add', policy_id, rules });
  check(added.added_count === 3 && (added.updated_count ?? 0) === 0, 'issue reproduction adds exactly three explicit filename rules');
  const afterAdd = await listRules();
  check(afterAdd.length === baseline.length + 3 && baselinePreserved(baseline, afterAdd), 'add preserves every baseline rule and appends three');
  check(rules.every(rule => afterAdd.some(current => current.type === rule.type && current.value === rule.value && current.status === rule.status && current.source === 'customer_api')), 'all explicit filenames are listed with requested status and API provenance');
  const detail = await call('show_policy', { policy_id });
  check(detail.current_version.version === policy.current_version.version + 1 && /Added 3 rules/.test(detail.current_version.change_message), 'new version and change note reflect actual added count');
  const sourcesAfter = await call('manage_policy_intel_sources', { action: 'list', policy_id });
  const sourceLinks = result => result.sources.map(source => ({
    id: source.id, last_synced_at: source.last_synced_at,
    source_kind: source.source_kind, is_enabled: source.is_enabled, platforms: source.platforms,
  })).sort((a, b) => a.id.localeCompare(b.id));
  check(sourcesBefore.sources.length > 0 && JSON.stringify(sourceLinks(sourcesBefore)) === JSON.stringify(sourceLinks(sourcesAfter)), 'attached intelligence sources and sync timestamps survive add');
  const repeated = await call('manage_policy_rules', { action: 'add', policy_name: policy.current_version.name, platform: 'windows', rules });
  check(repeated.added_count === 0 && repeated.duplicate_count === 3 && repeated.version_id === added.version_id, 'repeating by name returns three unchanged duplicates without a new version');
  const updated = await call('manage_policy_rules', { action: 'add', policy_id, rules: [{ ...rules[0], status: 'allowed' }] });
  check(updated.added_count === 0 && updated.updated_count === 1, 'existing filename status is updated rather than duplicated');
  const afterUpdate = await listRules();
  check(afterUpdate.length === baseline.length + 3 && baselinePreserved(baseline, afterUpdate) && afterUpdate.some(r => r.value === 'rustdesk.exe' && r.status === 'allowed'), 'status update preserves baseline rules and total');
  const invalid = await client.callTool({ name: 'manage_policy_rules', arguments: { action: 'add', policy_id, rules, event_ids: [events.events[0]?.id ?? policy_id] } });
  check(invalid.isError === true, 'ambiguous mixed input is rejected');
  const bad = await fetch(`${config.baseUrl}/api/public/v1/policies/${policy_id}/rules`, {
    method: 'POST', headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ rules: [{ rule_type: 'filename', file_name: 'ignored.exe' }] }), signal: AbortSignal.timeout(30000),
  });
  await bad.arrayBuffer();
  check(bad.status === 400, 'Portal rejects malformed explicit shape');
  const afterInvalid = await call('show_policy', { policy_id });
  check(afterInvalid.current_version.id === updated.version_id, 'invalid inputs create no new version');
  const event = events.events.find(e => e.file_name);
  if (event) {
    await call('manage_policy_rules', { action: 'add', policy_id, event_ids: [event.id], type: 'filename', status: 'blocked' });
    check(true, 'event-derived filename workflow succeeds');
  } else console.log('SKIP event-derived live write: no filename telemetry available');
  console.log(`Live policy checks passed: ${assertions} assertions. Delete the disposable fixture after inspection.`);
} catch (error) {
  console.error(String(error).replaceAll(config.apiKey, '[REDACTED]'));
  process.exitCode = 1;
} finally {
  await client.close();
}
