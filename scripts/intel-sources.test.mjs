import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { managePolicyIntelSourcesTool as tool } from '../dist/tools/manage_policy_intel_sources.js';

test('attachment batches stay within the server capture budget', () => {
  const schema = z.object(tool.inputSchema);
  const args = { action: 'attach', policy_id: '00000000-0000-4000-8000-000000000101' };
  const sourceIds = Array.from({ length: 61 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
  assert.equal(schema.safeParse({ ...args, source_ids: sourceIds.slice(0, 60) }).success, true);
  assert.equal(schema.safeParse({ ...args, source_ids: sourceIds }).success, false);
});
