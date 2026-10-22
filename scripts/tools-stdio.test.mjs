import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const policyId = id(101), endpointId = id(201), alertId = id(301), eventId = id(401), feedId = id(501), itemId = id(601);
const policy = { id: policyId, platform: 'windows', current_version: {
  id: id(102), name: 'Test Workstations', version: 1, status: 'audit', policy_mode: 'blocklist',
} };
const endpoint = { id: endpointId, computer_name: 'test-win-01', platform: 'windows', policy_id: policyId };
const alert = { id: alertId, severity: 'high', title: 'Fixture alert', created_at: '2026-10-19T00:00:00Z' };
const page = (key, value) => ({ [key]: [value], total: 1, limit: 1, offset: 0 });
const expectedTools = [
  'whoami', 'list_endpoints', 'show_endpoint', 'list_agent_releases', 'find_alerts', 'list_events',
  'triage_alert', 'list_policies', 'show_policy', 'manage_policy_rules', 'apply_policy_to_endpoints',
  'flip_to_enforcing', 'list_customer_intel_feeds', 'list_intel_sources', 'manage_customer_intel_feed', 'manage_customer_intel_item',
  'upsert_customer_intel_items', 'manage_policy_intel_sources', 'upgrade_endpoints', 'request_endpoint_checkin',
  'mint_enrollment_token', 'agent_install_instructions',
];

for (const mode of ['auto', 'legacy']) {
  test(`all 22 tools use the expected HTTP contracts and confirmation flows (${mode} stdio)`, { timeout: 30000 }, async () => {
    const pending = [];
    const exercised = new Set();
    const failures = [];
    let httpCalls = 0;
    const server = createServer(async (request, response) => {
      response.setHeader('content-type', 'application/json');
      try {
        httpCalls++;
        let raw = '';
        for await (const chunk of request) raw += chunk;
        const expected = pending.shift();
        assert.ok(expected, `Unexpected HTTP request: ${request.method} ${request.url}`);
        assert.equal(request.headers.authorization, 'Bearer msk_test_all_tools_1234567890');
        const url = new URL(request.url, 'http://localhost');
        assert.equal(request.method, expected.method);
        assert.equal(url.pathname, `/api/public/v1${expected.path}`);
        assert.deepEqual(Object.fromEntries(url.searchParams), expected.query ?? {});
        assert.deepEqual(raw ? JSON.parse(raw) : undefined, expected.body);
        response.statusCode = expected.status ?? 200;
        response.end(JSON.stringify(expected.result));
      } catch (error) {
        failures.push(error);
        response.statusCode = 500;
        response.end(JSON.stringify({ error: String(error) }));
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const client = new Client({ name: 'all-tools-contract', version: '1.0.0' }, { versionNegotiation: { mode } });
    const transport = new StdioClientTransport({
      command: process.execPath, args: [join(process.cwd(), 'dist/index.js')],
      env: { ...process.env, MAGICSWORD_API_KEY: 'msk_test_all_tools_1234567890',
        MAGICSWORD_BASE_URL: `http://127.0.0.1:${server.address().port}`,
        MAGICSWORD_CONFIG: join(tmpdir(), 'magicsword-all-tools-missing.json') },
    });
    const get = (path, result, query) => ({ method: 'GET', path, result, query });
    const write = (method, path, body, result = { success: true }) => ({ method, path, body, result });
    async function call(name, args, expected = [], error = false) {
      assert.equal(pending.length, 0);
      const before = httpCalls;
      pending.push(...expected);
      const result = await client.callTool({ name, arguments: args });
      if (failures.length) throw failures[0];
      assert.equal(Boolean(result.isError), error, `${name}: ${result.content[0]?.text}`);
      assert.equal(pending.length, 0, `${name} omitted an expected API request`);
      assert.equal(httpCalls - before, expected.length, `${name} sent unexpected HTTP calls`);
      exercised.add(name);
      return result;
    }
    try {
      await client.connect(transport);
      assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), [...expectedTools].sort());
      await call('whoami', {}, [get('/me', { org: { id: id(1), name: 'Fixture' }, key_id: 'fixture-key', scopes: ['policies:read'] })]);
      const endpoints = page('endpoints', endpoint);
      await call('list_endpoints', { platform: 'windows', status: 'active', hostname_pattern: 'test-*', limit: 1, offset: 0 }, [get('/endpoints', endpoints, { platform: 'windows', status: 'active', hostname_pattern: 'test-*', limit: '1', offset: '0' })]);
      await call('show_endpoint', { endpoint_id: endpointId }, [get(`/endpoints/${endpointId}`, { endpoint })]);
      await call('list_agent_releases', { platform: 'windows', latest: true }, [get('/agent-releases', { releases: [{ id: id(701), version: '1.0.0', created_at: '2026-10-19' }] }, { platform: 'windows', latest: 'true' })]);
      await call('find_alerts', { severity: 'high', acknowledged: false, hostname: 'test-*', mitre_technique: 'T1059', limit: 1 }, [get('/alerts', page('alerts', alert), { severity: 'high', acknowledged: 'false', hostname_pattern: 'test-*', mitre_technique: 'T1059', limit: '1' })]);
      await call('list_events', { hours: 24, status: 'audited,blocked', policy_id: policyId, limit: 1 }, [get('/events', { ...page('events', { id: eventId, name: 'test.exe', type: 'filename', status: 'audited' }), since: '2026-10-18' }, { hours: '24', status: 'audited,blocked', policy_id: policyId, limit: '1' })]);
      await call('triage_alert', { alert_id: alertId }, [get(`/alerts/${alertId}`, { alert })]);
      await call('triage_alert', { alert_id: alertId, ack: true, ack_comment: 'Fixture acknowledgement' }, [get(`/alerts/${alertId}`, { alert }), write('POST', `/alerts/${alertId}/acknowledge`, { comment: 'Fixture acknowledgement' })]);
      await call('triage_alert', { alert_id: alertId, dismiss: true, dismiss_reason: 'Fixture dismissal' }, [get(`/alerts/${alertId}`, { alert }), write('POST', `/alerts/${alertId}/dismiss`, { reason: 'Fixture dismissal' })]);
      await call('triage_alert', { alert_id: alertId, ack: true, dismiss: true }, [get(`/alerts/${alertId}`, { alert })], true);
      await call('list_intel_sources', { platform: 'windows', is_enabled: false, limit: 1, offset: 0 }, [get('/intel/sources', page('sources', { id: feedId, name: 'Fixture source', scope: 'global', is_enabled: false, is_premium: false }), { platform: 'windows', is_enabled: 'false', limit: '1', offset: '0' })]);
      await call('list_events', { type: 'filename', status: 'audited', file_name: 'image_(1).png', q: 'image', limit: 1, offset: 0 }, [get('/events', { ...page('events', { id: eventId, file_name: 'image_(1).png', type: 'filename', status: 'audited' }), since: '2026-10-18' }, { type: 'filename', status: 'audited', file_name: 'image_(1).png', q: 'image', limit: '1', offset: '0' })]);
      await call('list_events', { file_name: '' }, [], true);
      await call('list_intel_sources', { platform: 'plan9' }, [], true);
      await call('list_policies', { platform: 'windows' }, [get('/policies', { policies: [policy] }, { platform: 'windows' })]);
      await call('show_policy', { policy_id: policyId }, [get(`/policies/${policyId}`, { policy })]);
      const rules = [{ type: 'filename', value: 'rustdesk.exe', status: 'blocked' }];
      await call('manage_policy_rules', { action: 'add', policy_id: policyId, rules }, [write('POST', `/policies/${policyId}/rules`, { policy_id: policyId, rules }, { success: true, added_count: 1, updated_count: 0, duplicate_count: 0, version: 2 })]);
      await call('manage_policy_rules', { action: 'list', policy_id: policyId, limit: 1 }, [get(`/policies/${policyId}/rules`, page('rules', rules[0]), { limit: '1' })]);
      const assignment = { policy_id: policyId, endpoint_ids: [endpointId] };
      const preview = await call('apply_policy_to_endpoints', assignment, [get('/policies', { policies: [policy] })]);
      assert.equal(preview.structuredContent.requires_confirmation, true);
      await call('apply_policy_to_endpoints', { ...assignment, confirm: true }, [get('/policies', { policies: [policy] }), write('POST', `/policies/${policyId}/assign-endpoints`, { endpoint_ids: [endpointId] })]);
      const enforcement = await call('flip_to_enforcing', { policy_id: policyId }, [write('POST', `/policies/${policyId}/enforce-preview`, { acknowledge_blockers: false }, { can_enforce: true, preflight: { endpoint_count: 1 }, confirmation: { token: 'test-confirm-token', expires_at: '2026-10-19T01:00:00Z' }, blockers: [] })]);
      assert.match(enforcement.content[0].text, /test-confirm-token/);
      await call('flip_to_enforcing', { policy_id: policyId, confirmation_token: 'test-confirm-token' }, [write('POST', `/policies/${policyId}/enforce`, { confirmation_token: 'test-confirm-token' }, { ok: true, policy_id: policyId, new_version_id: id(103) })]);
      for (const response of [{}, { ok: false }, { ok: true, policy_id: id(999), new_version_id: id(103) }]) {
        const invalid = await call('flip_to_enforcing', { policy_id: policyId, confirmation_token: 'test-confirm-token' }, [write('POST', `/policies/${policyId}/enforce`, { confirmation_token: 'test-confirm-token' }, response)], true);
        assert.match(invalid.content[0].text, /show_policy/);
      }
      const partialEvents = await call('manage_policy_rules', { action: 'add', policy_id: policyId, event_ids: [eventId, id(402), id(403)] }, [write('POST', `/policies/${policyId}/rules`, { policy_id: policyId, event_ids: [eventId, id(402), id(403)] }, { added_count: 1, updated_count: 0, duplicate_count: 0, version: 9 })], true);
      assert.match(partialEvents.content[0].text, /1 of 3 unique events/);
      assert.equal(partialEvents.structuredContent.version, 9);
      const feed = { id: feedId, name: 'Fixture feed', item_count: 1 };
      await call('list_customer_intel_feeds', { limit: 1 }, [get('/intel/feeds', page('feeds', feed), { limit: '1' })]);
      await call('list_customer_intel_feeds', { feed_id: feedId, limit: 1 }, [get(`/intel/feeds/${feedId}/items`, page('items', { id: itemId, data: { filename: 'fixture.exe' } }), { limit: '1' })]);
      await call('manage_customer_intel_feed', { action: 'create', name: 'Fixture feed', platforms: ['windows'], is_enabled: false }, [write('POST', '/intel/feeds', { name: 'Fixture feed', platforms: ['windows'], is_enabled: false }, { feed })]);
      await call('manage_customer_intel_feed', { action: 'update', feed_id: feedId, description: 'Fixture updated' }, [write('PATCH', `/intel/feeds/${feedId}`, { description: 'Fixture updated' }, { feed })]);
      const deleteFeed = await call('manage_customer_intel_feed', { action: 'delete', feed_id: feedId });
      assert.equal(deleteFeed.structuredContent.requires_confirmation, true);
      const items = [{ filename: 'fixture.exe', description: 'Fixture indicator' }];
      await call('upsert_customer_intel_items', { feed_id: feedId, items }, [write('POST', `/intel/feeds/${feedId}/items`, { items }, { created: 1, updated: 0, restored: 0 })]);
      const item = { filename: 'fixture-updated.exe' };
      await call('manage_customer_intel_item', { action: 'update', feed_id: feedId, item_id: itemId, item }, [write('PATCH', `/intel/feeds/${feedId}/items/${itemId}`, item)]);
      assert.equal((await call('manage_customer_intel_item', { action: 'delete', feed_id: feedId, item_id: itemId })).structuredContent.requires_confirmation, true);
      await call('manage_customer_intel_item', { action: 'delete', feed_id: feedId, item_id: itemId, confirm: true }, [write('DELETE', `/intel/feeds/${feedId}/items/${itemId}`, undefined)]);
      await call('manage_policy_intel_sources', { action: 'list', policy_id: policyId }, [get(`/policies/${policyId}/intel-sources`, { sources: [] })]);
      await call('manage_policy_intel_sources', { action: 'attach', policy_id: policyId, source_ids: [feedId] }, [write('POST', `/policies/${policyId}/intel-sources`, { source_ids: [feedId] }, { success: true, result: { sourcesAttached: 1, skippedAlreadyAttached: 0 } })]);
      const unchangedSources = await call('manage_policy_intel_sources', { action: 'attach', policy_id: policyId, source_ids: [feedId] }, [write('POST', `/policies/${policyId}/intel-sources`, { source_ids: [feedId] }, { success: true, result: { sourcesAttached: 0, skippedAlreadyAttached: 1 } })]);
      assert.match(unchangedSources.content[0].text, /No changes needed: 1 intel source\(s\) already attached/);
      await call('manage_policy_intel_sources', { action: 'attach', policy_id: policyId, source_ids: [feedId] }, [write('POST', `/policies/${policyId}/intel-sources`, { source_ids: [feedId] }, {})], true);
      await call('manage_policy_intel_sources', { action: 'detach', policy_id: policyId, source_id: feedId }, [write('DELETE', `/policies/${policyId}/intel-sources/${feedId}`, undefined)]);
      await call('manage_customer_intel_feed', { action: 'delete', feed_id: feedId, confirm: true }, [write('DELETE', `/intel/feeds/${feedId}`, undefined)]);
      assert.equal((await call('upgrade_endpoints', { endpoint_id: endpointId })).structuredContent.requires_confirmation, true);
      await call('upgrade_endpoints', { endpoint_id: endpointId, target_version: '1.0.0', confirm: true }, [write('POST', `/endpoints/${endpointId}/upgrade`, { target_version: '1.0.0' })]);
      await call('upgrade_endpoints', { endpoint_ids: [endpointId], confirm: true }, [write('POST', '/endpoints/bulk-upgrade', { endpoint_ids: [endpointId], target_version: 'latest', update_all_outdated: true, all: false })]);
      await call('request_endpoint_checkin', { endpoint_id: endpointId }, [write('POST', `/endpoints/${endpointId}/commands/checkin`, {})]);
      const minted = await call('mint_enrollment_token', { ttl_seconds: 300 }, [write('POST', '/enrollment-tokens', { ttl_seconds: 300 }, { token: 'test-enrollment-token', org_id: id(1), expires_at: '2026-10-19', ttl_seconds: 300 })]);
      assert.equal(minted.structuredContent.token, 'test-enrollment-token');
      for (const platform of ['windows', 'macos', 'linux']) {
        const install = await call('agent_install_instructions', { platform });
        assert.match(install.content[0].text, /https:\/\/www.magicsword.io\/install\.(ps1|sh)/);
      }
      const denied = get('/me', { error: 'test key missing scope' });
      denied.status = 403;
      await call('whoami', {}, [denied], true);
      assert.deepEqual([...exercised].sort(), [...expectedTools].sort());
    } finally {
      await client.close();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
}
