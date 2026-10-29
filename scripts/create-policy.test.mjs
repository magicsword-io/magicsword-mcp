import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { createPolicyTool as tool } from '../dist/tools/create_policy.js';
import { MagicSwordApiError } from '../dist/client.js';
import { annotationsForTool } from '../dist/tools/index.js';

const schema = z.strictObject(tool.inputSchema);
const args = { name: 'My new policy', platform: 'windows' };
const policy = { id: '00000000-0000-4000-8000-000000000101', platform: 'windows',
  created_at: '2026-10-29T00:00:00Z', updated_at: '2026-10-29T00:00:00Z',
  current_version: { id: '00000000-0000-4000-8000-000000000102',
    policy_id: '00000000-0000-4000-8000-000000000101', name: args.name,
    version: 1, status: 'audit', policy_mode: 'blocklist' } };

test('CREATE-001 validates bounded explicit input without permitting actor, tenant or enforcement overrides', () => {
  assert.deepEqual(schema.parse({ ...args, name: '  My new policy  ' }), args);
  for (const bad of [{}, { name: args.name }, { ...args, name: ' ' },
    { ...args, name: 'x'.repeat(201) }, { ...args, name: 'bad\u0000name' },
    { ...args, name: 'bad\u0085name' }, { ...args, platform: 'unknown' },
    { ...args, name: 'name\n' },
    { ...args, policy_mode: 'allowlist' }, { ...args, organization_id: policy.id },
    { ...args, status: 'enforcing' }, { ...args, rules: [] }, { ...args, xml: '<SiPolicy />' }]) {
    assert.equal(schema.safeParse(bad).success, false, JSON.stringify(bad));
  }
});

test('CREATE-003 defaults blocklist and reports verified audit policy identity', async () => {
  let calls = 0;
  const result = await tool.handler(args, { client: { async createPolicy(body) {
    calls++; assert.deepEqual(body, { ...args, policy_mode: 'blocklist' }); return { policy };
  } } });
  assert.equal(calls, 1);
  assert.ok(!result.isError);
  assert.equal(result.structuredContent.policy.id, policy.id);
  assert.match(result.content[0].text, /Version 1, audit mode, blocklist/);
  assert.match(result.content[0].text, /No devices assigned/);
  assert.deepEqual(annotationsForTool('create_policy'), {
    readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false,
  });
});

test('CREATE-001 rejects Linux strict without calling the API', async () => {
  const result = await tool.handler({ ...args, platform: 'linux', policy_mode: 'strict' }, {
    client: { async createPolicy() { assert.fail('Unsupported mode must not be sent'); } },
  });
  assert.equal(result.isError, true);
});

test('CREATE-004 refuses malformed or mismatched creation responses without retry', async () => {
  const responses = [null, {}, { policy: null }, { policy: { ...policy, id: 'bad-id' } },
    { policy: { ...policy, platform: 'macos' } }, { policy: { ...policy, created_at: 'invalid' } },
    ...[{ status: 'enforcing' }, { version: 2 }, { policy_id: '00000000-0000-4000-8000-000000000999' },
      { name: 'Other policy' }, { policy_mode: 'strict' }].map(change => ({ policy: {
        ...policy, current_version: { ...policy.current_version, ...change },
      } })),
  ];
  for (const response of responses) {
    let calls = 0;
    const result = await tool.handler(args, { client: { async createPolicy() { calls++; return response; } } });
    assert.equal(result.isError, true);
    assert.equal(calls, 1);
    assert.match(result.content[0].text, /List policies before retrying/);
  }
});

test('CREATE-004 surfaces plan/scope failures and warns on uncertain writes without retrying', async () => {
  for (const error of [new MagicSwordApiError(403, { error: 'Strict mode requires Enterprise' }, 'http://localhost'),
    new MagicSwordApiError(503, { error: 'Unavailable' }, 'http://localhost'), new Error('Transport failed')]) {
    let calls = 0;
    const result = await tool.handler(args, { client: { async createPolicy() { calls++; throw error; } } });
    assert.equal(calls, 1);
    assert.equal(result.isError, true);
    if (error.status === 403) assert.match(result.content[0].text, /Strict mode requires Enterprise/);
    else assert.match(result.content[0].text, /List policies before retrying/);
  }
});
