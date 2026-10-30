import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { z } from 'zod';
import { MagicSwordClient } from '../dist/client.js';
import { clonePolicyTool as clone } from '../dist/tools/clone_policy.js';
import { listEndpointGroupsTool as groups } from '../dist/tools/list_endpoint_groups.js';
import { applyPolicyToEndpointsTool as assign } from '../dist/tools/apply_policy_to_endpoints.js';
import { annotationsForTool } from '../dist/tools/index.js';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const policyId = id(1), cloneId = id(2), versionId = id(3), endpointId = id(4), groupId = id(5);
const token = 'msac_' + 'a'.repeat(43);
const cloned = { policy: { id: cloneId, platform: 'windows', created_at: '2026-10-29', updated_at: '2026-10-29',
  current_version: { id: id(6), policy_id: cloneId, name: 'My copy', version: 1, status: 'audit', parent_version_id: null, policy_mode: 'blocklist' } },
  cloned_from: { policy_id: policyId, version_id: versionId }, copied: { rules: 1201, intelligence_sources: 2, analytics_collections: 2 } };
const preview = { policy_id: policyId, current_version_id: versionId, platform: 'windows', status: 'audit', policy_mode: 'blocklist',
  endpoint_count: 1, requires_confirmation: true,
  would_assign: [{ id: endpointId, computer_name: 'win-01', platform: 'windows', policy_id: null, desired_policy_ids: [] }],
  confirmation: { token, expires_at: '2100-01-01T00:00:00Z', action: 'policy.assign' } };
const committed = { success: true, policy_id: policyId, current_version_id: versionId, updated: 1, endpoint_ids: [endpointId], assignment_status: 'pending_checkin' };
const invoke = (tool, args, client) => tool.handler(args, { client });

test('CLONE-001 strict inputs reject tenant/actor/status/rules overrides and control characters', () => {
  const schema = z.strictObject(clone.inputSchema);
  assert.equal(schema.parse({ policy_id: policyId, name: ' My copy ' }).name, 'My copy');
  for (const extra of [{ name: '' }, { name: 'x'.repeat(201) }, { name: 'bad\n' }, { name: 'bad\u0085' },
    { organization_id: cloneId }, { actor_id: cloneId }, { status: 'enforcing' }, { rules: [] }]) {
    assert.equal(schema.safeParse({ policy_id: policyId, name: 'My copy', ...extra }).success, false);
  }
});
test('CLONE-002 reports a verified independent audit root without an assignment', async () => {
  for (const platform of ['windows', 'macos', 'linux']) {
    const result = await invoke(clone, { policy_id: policyId, name: 'My copy' }, {
      async clonePolicy(source, body) { assert.equal(source, policyId); assert.deepEqual(body, { name: 'My copy' }); return { ...cloned, policy: { ...cloned.policy, platform } }; },
    });
    assert(!result.isError); assert.equal(result.structuredContent.policy.id, cloneId);
    assert.match(result.content[0].text, /No computers assigned/);
  }
  assert.equal(annotationsForTool('clone_policy').destructiveHint, false);
  assert.equal(annotationsForTool('clone_policy').idempotentHint, false);
  assert.equal(annotationsForTool('list_endpoint_groups').readOnlyHint, true);
  assert.equal(annotationsForTool('apply_policy_to_endpoints').destructiveHint, true);
});
test('CLONE-003 malformed or unbound success is uncertain and never retried', async () => {
  for (const change of [null, {}, { ...cloned, policy: { ...cloned.policy, id: policyId } },
    { ...cloned, cloned_from: { policy_id: cloneId, version_id: versionId } },
    ...[{ status: 'enforcing' }, { parent_version_id: versionId }, { name: 'Another copy' }, { policy_id: policyId }, { version: 2 }, { id: 'bad' }]
      .map(delta => ({ ...cloned, policy: { ...cloned.policy, current_version: { ...cloned.policy.current_version, ...delta } } })),
    { ...cloned, copied: { ...cloned.copied, rules: -1 } }]) {
    let count = 0;
    const result = await invoke(clone, { policy_id: policyId, name: 'My copy' }, { async clonePolicy() { count++; return change; } });
    assert.equal(count, 1); assert(result.isError); assert.match(result.content[0].text, /List policies before retrying/);
  }
});
test('ASSIGN-001 group discovery validates paging and refuses invalid or duplicated IDs', async () => {
  const page = { groups: [{ id: groupId, name: 'Engineering', parent_group_id: null, description: null }], total: 1, limit: 1, offset: 0 };
  const valid = await invoke(groups, { limit: 1 }, { async endpointGroups(args) { assert.deepEqual(args, { limit: 1, offset: undefined }); return page; } });
  assert(!valid.isError); assert.match(valid.content[0].text, /Engineering/);
  for (const body of [{ ...page, groups: [...page.groups, ...page.groups], limit: 2 }, { ...page, total: 0 }, { ...page, offset: 1 }, {}]) {
    assert((await invoke(groups, { limit: 1 }, { async endpointGroups() { return body; } })).isError);
  }
});
test('MCP-001 all selectors preview through the server and include descendants by default', async () => {
  for (const [args, expected] of [
    [{ endpoint_ids: [endpointId] }, { endpoint_ids: [endpointId] }],
    [{ group_ids: [groupId] }, { group_ids: [groupId], include_descendants: true }],
    [{ group_ids: [groupId], include_descendants: false }, { group_ids: [groupId], include_descendants: false }],
    [{ hostname_pattern: 'win-*', platform: 'windows' }, { hostname_pattern: 'win-*', platform: 'windows' }],
  ]) {
    const result = await invoke(assign, { policy_id: policyId, ...args }, { async previewPolicyAssignment(policy, selector) {
      assert.equal(policy, policyId); assert.deepEqual(selector, expected); return preview;
    } });
    assert(!result.isError); assert.match(result.content[0].text, /REPLACES/); assert.match(result.content[0].text, /audit policy can remove existing blocking/);
  }
});
test('ASSIGN-002 invalid selectors, legacy bool and token/selector mixtures cannot call the API', async () => {
  const client = new Proxy({}, { get() { assert.fail('Invalid request must not reach client'); } });
  for (const args of [{}, { endpoint_ids: [endpointId], group_ids: [groupId] },
    { endpoint_ids: [endpointId], include_descendants: true }, { endpoint_ids: [endpointId], platform: 'windows' },
    { endpoint_ids: [endpointId], confirm: true }, { confirmation_token: token, endpoint_ids: [endpointId] },
    { confirmation_token: token, confirm: true }]) {
    assert((await invoke(assign, { policy_id: policyId, ...args }, client)).isError);
  }
});
test('ASSIGN-002 preview rejects changed target identity, mode, platform, counts and expiration', async () => {
  for (const body of [{ ...preview, policy_id: cloneId }, { ...preview, endpoint_count: 2 },
    { ...preview, endpoint_count: 2, would_assign: [...preview.would_assign, ...preview.would_assign] },
    { ...preview, would_assign: [{ ...preview.would_assign[0], id: cloneId }] },
    { ...preview, would_assign: [{ ...preview.would_assign[0], platform: 'linux' }] },
    { ...preview, confirmation: { ...preview.confirmation, expires_at: '2000-01-01' } },
    { ...preview, confirmation: { ...preview.confirmation, action: 'policy.enforce' } }]) {
    const result = await invoke(assign, { policy_id: policyId, endpoint_ids: [endpointId] }, { async previewPolicyAssignment() { return body; } });
    assert(result.isError); assert.match(result.content[0].text, /No commit was requested/);
  }
});
test('ASSIGN-003 commit uses only the token and reports desired state rather than deployment', async () => {
  const result = await invoke(assign, { policy_id: policyId, confirmation_token: token }, { async assignPolicyWithConfirmation(policy, value) {
    assert.equal(policy, policyId); assert.equal(value, token); return committed;
  } });
  assert(!result.isError); assert.match(result.content[0].text, /desired assignment/); assert.match(result.content[0].text, /installation and enforcement have not been verified/);
  for (const body of [{ ...committed, policy_id: cloneId }, { ...committed, updated: 2 },
    { ...committed, updated: 2, endpoint_ids: [endpointId, endpointId] }, { ...committed, assignment_status: 'installed' }, {}]) {
    const invalid = await invoke(assign, { policy_id: policyId, confirmation_token: token }, { async assignPolicyWithConfirmation() { return body; } });
    assert(invalid.isError); assert.match(invalid.content[0].text, /may have committed/);
  }
});
test('CLONE-003 and ASSIGN-003 actual HTTP writes are not retried and transport errors reveal no secrets', async () => {
  const calls = [];
  const server = createServer((req, res) => { calls.push(req.url); req.resume(); res.writeHead(503, { 'content-type': 'application/json' }).end('{"error":"internal-secret"}'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const client = new MagicSwordClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: 'msk_fixture_private_12345678', getRetries: 3 });
    const copy = await invoke(clone, { policy_id: policyId, name: 'My copy' }, client);
    const apply = await invoke(assign, { policy_id: policyId, confirmation_token: token }, client);
    assert.equal(calls.length, 2); assert(copy.isError && apply.isError);
    for (const result of [copy, apply]) assert.doesNotMatch(result.content[0].text, /internal-secret|msk_fixture_private/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
