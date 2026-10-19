import assert from 'node:assert/strict';
import test from 'node:test';
import { flipToEnforcingTool as tool } from '../dist/tools/flip_to_enforcing.js';

const policy_id = '00000000-0000-4000-8000-000000000101';
const new_version_id = '00000000-0000-4000-8000-000000000102';

test('enforcement commits require a verified successful response for the requested policy', async () => {
  for (const response of [{}, null, { ok: false }, { ok: true },
    { ok: true, policy_id, new_version_id: 'invalid' },
    { ok: true, policy_id: new_version_id, new_version_id },
    { ok: false, policy_id, new_version_id }]) {
    let calls = 0;
    const result = await tool.handler({ policy_id, confirmation_token: 'fixture-token' }, {
      client: { async enforcePolicy() { calls++; return response; } },
    });
    assert.equal(result.isError, true, JSON.stringify(response));
    assert.match(result.content[0].text, /show_policy/);
    assert.match(result.content[0].text, /before retrying/);
    assert.equal(calls, 1);
  }
  const response = { ok: true, policy_id, new_version_id, endpoint_count: 2 };
  const result = await tool.handler({ policy_id, confirmation_token: 'fixture-token' }, {
    client: { async enforcePolicy() { return response; } },
  });
  assert.ok(!result.isError);
  assert.equal(result.structuredContent, response);
});
