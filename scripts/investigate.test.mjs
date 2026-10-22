import assert from 'node:assert/strict';
import test from 'node:test';
import { listEventsTool } from '../dist/tools/list_events.js';
import { listIntelSourcesTool } from '../dist/tools/list_intel_sources.js';
import { managePolicyIntelSourcesTool } from '../dist/tools/manage_policy_intel_sources.js';
import { MagicSwordApiError } from '../dist/client.js';

test('INV-001: event text includes every returned row and investigation evidence', async () => {
  const events = Array.from({ length: 75 }, (_, i) => ({
    id: `event-${i}`, type: 'filename', status: 'audited', platform: 'windows', file_name: 'image.png',
    file_path: 'C:\\image.png', file_hash: 'abc123', publisher: 'Fixture', computer_name: 'workstation',
    occurrence_count: 7, created_at: '2020-01-01', last_seen_at: '2026-10-21',
  }));
  const page = { events, total: 80, limit: 75, offset: 0, since: '2026-10-20' };
  const args = { type: 'filename', status: 'audited', file_name: 'image.png', hours: 24, limit: 75 };
  const result = await listEventsTool.handler(args, { client: { async events(query) {
    assert.deepEqual(query, args); return page;
  } } });
  assert.equal(result.structuredContent, page);
  assert.match(result.content[0].text, /Showing 75 at offset 0/);
  assert.match(result.content[0].text, /id=event-74/);
  assert.match(result.content[0].text, /2026-10-21.*computer=workstation.*hash=abc123.*publisher=Fixture.*occurrences=7/);
});

test('INTEL-001: source discovery preserves IDs, scope, disabled filter and pagination', async () => {
  const args = { platform: 'windows', is_enabled: false, limit: 1, offset: 5 };
  const page = { sources: [{ id: 'source-id', name: 'Fixture', scope: 'global', is_enabled: false, is_premium: true, item_count: 42 }], total: 8, limit: 1, offset: 5 };
  const result = await listIntelSourcesTool.handler(args, { client: { async intelSources(query) {
    assert.deepEqual(query, args); return page;
  } } });
  assert.equal(result.structuredContent, page);
  assert.match(result.content[0].text, /source-id.*global.*42 items.*enabled: false.*premium: true/);
  assert.match(result.content[0].text, /Showing 1 at offset 5/);
});

test('INTEL-001: source discovery returns actionable scope failures', async () => {
  const result = await listIntelSourcesTool.handler({}, { client: { async intelSources() {
    throw new MagicSwordApiError(403, { error: 'Missing scope: intel:read' }, 'http://localhost');
  } } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /intel:read/);
});

test('INTEL-002: attachment listing presents names and IDs and rejects invalid lists', async () => {
  const policy_id = '00000000-0000-4000-8000-000000000101';
  const page = { sources: [{ id: 'source-id', name: 'Fixture source' }] };
  const result = await managePolicyIntelSourcesTool.handler({ action: 'list', policy_id }, {
    client: { async policyIntelSources(id) { assert.equal(id, policy_id); return page; } },
  });
  assert.match(result.content[0].text, /Fixture source — id: source-id/);
  for (const response of [{}, null, { sources: 'missing' }]) {
    const error = await managePolicyIntelSourcesTool.handler({ action: 'list', policy_id }, {
      client: { async policyIntelSources() { return response; } },
    });
    assert.equal(error.isError, true);
  }
});
