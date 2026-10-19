import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { managePolicyIntelSourcesTool as tool } from '../dist/tools/manage_policy_intel_sources.js';

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
