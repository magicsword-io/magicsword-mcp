import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { MagicSwordClient } from '../dist/client.js';
import { z } from 'zod';
import { managePolicyIntelSourcesTool as tool } from '../dist/tools/manage_policy_intel_sources.js';
import { listIntelSourcesTool } from '../dist/tools/list_intel_sources.js';

test('source discovery includes all API dates in text and preserves structured content', async () => {
  const source = {
    id: '00000000-0000-4000-8000-000000000501', name: 'Fixture source',
    scope: 'global', is_enabled: true, is_premium: false,
    created_at: '2026-09-01T08:00:00+00:00', updated_at: '2026-10-30T12:00:00+00:00',
    last_sync: '2026-10-29T09:30:00+00:00', last_checked_at: '2026-11-02T09:30:00+00:00',
  };
  const response = { sources: [source], total: 1, limit: 50, offset: 0 };
  const args = { platform: 'windows', limit: 50 };
  const result = await listIntelSourcesTool.handler(args, {
    client: { async intelSources(query) { assert.deepEqual(query, args); return response; } },
  });
  assert.ok(!result.isError);
  assert.equal(result.structuredContent, response);
  for (const [label, value] of [
    ['created', source.created_at], ['updated', source.updated_at],
    ['last synced', source.last_sync], ['last checked', source.last_checked_at],
  ]) assert.ok(result.content[0].text.includes(`${label}: ${value}`));
});

test('null and absent source dates remain unknown, including with older APIs', async () => {
  for (const dates of [{}, { created_at: null, updated_at: null, last_sync: null, last_checked_at: null },
    { created_at: '', updated_at: ' ', last_sync: 'not-a-date', last_checked_at: '' }]) {
    const source = { id: 'source-id', name: 'Fixture source', scope: 'organization', is_enabled: true, is_premium: false, ...dates };
    const response = { sources: [source], total: 1, limit: 50, offset: 0 };
    const result = await listIntelSourcesTool.handler({}, { client: { async intelSources() { return response; } } });
    assert.ok(!result.isError);
    assert.equal(result.structuredContent, response);
    for (const label of ['created', 'updated', 'last synced', 'last checked']) {
      assert.ok(result.content[0].text.includes(`${label}: unknown`));
    }
    assert.doesNotMatch(result.content[0].text, /undefined|null|1970/);
  }
});

const policy_id = '00000000-0000-4000-8000-000000000101';
const source_ids = [1, 2, 3].map(index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
async function attach(ids, response) {
  let calls = 0;
  const result = await tool.handler({ action: 'attach', policy_id, source_ids: ids }, {
    client: { async attachIntelSources() { calls++; return response; } },
  });
  assert.equal(calls, 1, 'attachment writes must not be retried');
  return result;
}

test('attachment batches stay within the server capture budget', () => {
  const schema = z.object(tool.inputSchema);
  const args = { action: 'attach', policy_id: '00000000-0000-4000-8000-000000000101' };
  const sourceIds = Array.from({ length: 61 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
  assert.equal(schema.safeParse({ ...args, source_ids: sourceIds.slice(0, 60) }).success, true);
  assert.equal(schema.safeParse({ ...args, source_ids: sourceIds }).success, false);
});

test('attachment summaries report saved and already-attached counts separately', async () => {
  const response = { success: true, result: { sourcesAttached: 1, skippedAlreadyAttached: 2, newVersionId: policy_id } };
  const result = await attach(source_ids, response);
  assert.ok(!result.isError);
  assert.match(result.content[0].text, /Attached 1 intel source/);
  assert.match(result.content[0].text, /2 already attached/);
  assert.equal(result.structuredContent, response);
});

test('already-attached sources report a no-change result, including repeated input IDs', async () => {
  const result = await attach([source_ids[0], source_ids[0]], {
    success: true, result: { sourcesAttached: 0, skippedAlreadyAttached: 1 },
  });
  assert.ok(!result.isError);
  assert.match(result.content[0].text, /No changes needed: 1 intel source\(s\) already attached/);
});

test('malformed or incomplete attachment results never claim success or retry writes', async () => {
  for (const response of [{}, null, { success: false },
    { success: false, result: { sourcesAttached: 1, skippedAlreadyAttached: 0 } },
    { success: true, result: { sourcesAttached: 1 } },
    { success: true, result: { sourcesAttached: -1, skippedAlreadyAttached: 2 } },
    { success: true, result: { sourcesAttached: 0.5, skippedAlreadyAttached: 0.5 } },
    { success: true, result: { sourcesAttached: '1', skippedAlreadyAttached: 0 } },
    { success: true, result: { sourcesAttached: 0, skippedAlreadyAttached: 0 } },
    { success: true, result: { sourcesAttached: 2, skippedAlreadyAttached: 0 } }]) {
    const result = await attach([source_ids[0]], response);
    assert.equal(result.isError, true, JSON.stringify(response));
    assert.match(result.content[0].text, /list.*before retrying/i);
  }
});


test('freshness HTTP seam preserves dates and pagination; outages never become empty success', async () => {
  const calls = [];
  const response = { sources: [{ id: 'fixture', name: 'Fixture', scope: 'global', is_enabled: true,
    is_premium: true, created_at: null, updated_at: '2026-10-30T12:00:00Z',
    last_sync: null, last_checked_at: '2026-11-02T09:30:00Z' }], total: 3, limit: 1, offset: 2 };
  let status = 200;
  const server = createServer((req, res) => {
    calls.push({ url: req.url, authorization: req.headers.authorization });
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(
      status === 200 ? response : { error: 'Service unavailable' }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const client = new MagicSwordClient({ baseUrl: `http://127.0.0.1:${server.address().port}`,
      apiKey: 'msk_synthetic_fixture', getRetries: 0 });
    const args = { platform: 'windows', is_enabled: false, limit: 1, offset: 2 };
    const result = await listIntelSourcesTool.handler(args, { client });
    assert.ok(!result.isError);
    assert.deepEqual(result.structuredContent, response);
    assert.match(result.content[0].text, /last checked: 2026-11-02T09:30:00Z/);
    assert.match(result.content[0].text, /premium: true/);
    assert.equal(calls[0].url, '/api/public/v1/intel/sources?platform=windows&is_enabled=false&limit=1&offset=2');
    assert.equal(calls[0].authorization, 'Bearer msk_synthetic_fixture');
    status = 503;
    const unavailable = await listIntelSourcesTool.handler(args, { client });
    assert.equal(unavailable.isError, true);
    assert.equal(unavailable.structuredContent, undefined);
    assert.doesNotMatch(unavailable.content[0].text, /Found 0|last checked:/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
