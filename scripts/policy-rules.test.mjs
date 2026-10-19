import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { managePolicyRulesTool as tool } from '../dist/tools/manage_policy_rules.js';

const policy_id = '00000000-0000-4000-8000-000000000101';
const event_id = '00000000-0000-4000-8000-000000000401';
const rule = { type: 'filename', value: 'rustdesk.exe', status: 'blocked' };
const schema = z.object(tool.inputSchema);
const invoke = (args, response) => tool.handler(args, { client: { async addPolicyRules() { return response; } } });

test('RULES-01 rejects malformed explicit rules at the MCP schema boundary', () => {
  for (const bad of [{}, { rule_type: 'filename', file_name: 'rustdesk.exe' },
    { ...rule, status: 'block' }, { ...rule, value: '' }, { ...rule, value: '  ' },
    { ...rule, type: 'nonsense' }, { ...rule, value: 42 }, { ...rule, value: {} },
    { ...rule, file_name: 'ignored.exe' }]) {
    assert.equal(schema.safeParse({ action: 'add', policy_id, rules: [bad] }).success, false, JSON.stringify(bad));
  }
});

test('RULES-02 rejects mixed sources before calling the API, including empty event_ids', async () => {
  for (const event_ids of [[], [event_id]]) {
    let calls = 0;
    const result = await tool.handler({ action: 'add', policy_id, rules: [rule], event_ids }, {
      client: { async addPolicyRules() { calls++; return { added_count: 1 }; } },
    });
    assert.equal(result.isError, true);
    assert.equal(calls, 0);
  }
});

test('RULES-03 does not report a zero-count or malformed response as success', async () => {
  for (const response of [{ added_count: 0 }, {}, null, { added_count: -1 },
    { added_count: '3' }, { added_count: 1.5 }, { added_count: 0, updated_count: -1 },
    { success: false, added_count: 3 }]) {
    const result = await invoke({ action: 'add', policy_id, rules: [rule] }, response);
    assert.equal(result.isError, true, JSON.stringify(response));
  }
});

test('RULES-03 reports status updates and acknowledged duplicates accurately', async () => {
  const updated = await invoke({ action: 'add', policy_id, rules: [rule] }, { added_count: 0, updated_count: 1, duplicate_count: 0 });
  assert.ok(!updated.isError);
  assert.match(updated.content[0].text, /updated 1/i);
  const duplicate = await invoke({ action: 'add', policy_id, rules: [rule] }, { added_count: 0, updated_count: 0, duplicate_count: 1 });
  assert.ok(!duplicate.isError);
  assert.match(duplicate.content[0].text, /no changes/i);
  assert.match(duplicate.content[0].text, /1.*already/i);
});

test('RULES-01 accepts typed rule values and optional Customer API metadata', () => {
  const fixtures = [
    rule,
    { type: 'filepath', value: '%OSDRIVE%\\Tools\\tool.exe' },
    { type: 'publisher', value: { publisherName: 'Example', signerName: 'Example', tbsHash: 'a'.repeat(64) } },
    { type: 'publisher', value: { publisher: 'Example', certificate_thumbprint: 'b'.repeat(40) } },
    { type: 'browser_extension', value: { extensionId: 'extension', browser: 'chrome' } },
    { type: 'packagefamilyname', value: { packageFamilyName: 'Example_family', version: '1' } },
    { type: 'package', value: { name: 'example', manager: 'apt', version: '1' } },
    { type: 'path', value: '/opt/example/*' },
    { type: 'team_id', value: 'ABCDEFGHIJ' },
    { type: 'signing_id', value: 'ABCDEFGHIJ:io.example.app' },
    { type: 'cdhash', value: 'a'.repeat(40) },
    { type: 'cdhash', value: { value: 'b'.repeat(40) } },
    { type: 'cdhash', value: { path: 'c'.repeat(40) } },
    { type: 'app_bundle', value: '/Applications/Example.app' },
    { type: 'bundle_id', value: 'io.example.app', status: 'disabled' },
    { type: 'amsi', value: { rule_id: 'example-rule' } },
    { type: 'hash', value: { SHA256: 'b'.repeat(64) }, status: 'disabled' },
    { type: 'fileattrib', value: 'file-attribute-reference' },
    { type: 'scr', value: { id: 'custom', parent_match: { type: 'path', values: ['/bin/sh'] } } },
    { type: 'asr', value: 'rule-id' },
    { ...rule, name: 'Example', mode: 'both', min_version: '1', max_version: null,
      linked_signer_id: 'signer', file_attrib_refs: ['ref'], package_version: '1', target_platforms: ['windows'] },
  ];
  for (const value of fixtures) {
    const parsed = schema.parse({ action: 'add', policy_id, rules: [value] });
    assert.deepEqual(parsed.rules[0], value);
  }
  for (const bad of [
    { type: 'publisher', value: { publisherName: 'Example' } },
    { type: 'publisher', value: { publisherName: 'Example', tbsHash: 'bad' } },
    { type: 'browser_extension', value: { extensionId: 'id', browser: 'unknown' } },
    { type: 'cdhash', value: 'a'.repeat(64) },
    { type: 'cdhash', value: { value: 'invalid' } },
    { ...rule, target_platforms: [] }, { ...rule, mode: 'unknown' },
  ]) assert.equal(schema.safeParse({ action: 'add', policy_id, rules: [bad] }).success, false);
});

test('RULES-02 rejects missing identifiers, missing inputs and event-only options on explicit rules', async () => {
  for (const args of [
    { action: 'add', rules: [rule] }, { action: 'add', policy_id },
    { action: 'list' }, { action: 'add', policy_id, rules: [rule], status: 'allowed' },
    { action: 'add', policy_id, rules: [rule], type: 'filename' },
  ]) {
    const result = await tool.handler(args, { client: {} });
    assert.equal(result.isError, true);
  }
  for (const args of [
    { action: 'add', policy_id, rules: [] },
    { action: 'add', policy_id, event_ids: [] },
    { action: 'add', policy_name: '   ', rules: [rule] },
    { action: 'add', policy_name: 'x'.repeat(256), rules: [rule] },
    { action: 'add', policy_id, rules: Array(101).fill(rule) },
    { action: 'add', policy_id, event_ids: ['not-a-uuid'] },
    { action: 'add', policy_id, event_ids: [event_id], type: 'unknown' },
  ]) assert.equal(schema.safeParse(args).success, false);
});

test('RULES-03 preserves returned counts and version details without inventing counts', async () => {
  const response = { success: true, added_count: 1, updated_count: 1, duplicate_count: 1, version: 8, version_id: policy_id };
  const result = await invoke({ action: 'add', policy_id, rules: [rule, rule, rule] }, response);
  assert.ok(!result.isError);
  assert.equal(result.structuredContent, response);
  assert.match(result.content[0].text, /added 1, updated 1, already unchanged 1/);
});


test('RULES-03 requires each reported count and explains a verified zero-change response', async () => {
  const complete = { added_count: 0, updated_count: 0, duplicate_count: 1 };
  for (const field of ['added_count', 'updated_count', 'duplicate_count']) {
    const incomplete = { ...complete };
    delete incomplete[field];
    const result = await invoke({ action: 'add', policy_id, rules: [rule] }, incomplete);
    assert.equal(result.isError, true, field);
    assert.match(result.content[0].text, /outcome could not be verified/);
  }
  const result = await invoke({ action: 'add', policy_id, rules: [rule] }, {
    added_count: 0, updated_count: 0, duplicate_count: 0,
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /0 rules added and 0 updated/);
  assert.equal(result.structuredContent.added_count, 0);
});

test('RULES-03 flags partially derived events without retrying a write or hiding version details', async () => {
  const event_ids = [event_id, '00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000403'];
  const response = { added_count: 1, updated_count: 0, duplicate_count: 0, version: 9 };
  let calls = 0;
  const result = await tool.handler({ action: 'add', policy_id, event_ids }, {
    client: { async addPolicyRules() { calls++; return response; } },
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /1 of 3 unique events/);
  assert.match(result.content[0].text, /before retrying/);
  assert.equal(result.structuredContent, response);
  assert.equal(calls, 1);
});

test('RULES-03 accepts complete event accounting including repeated event IDs and unchanged rules', async () => {
  const result = await invoke({ action: 'add', policy_id, event_ids: [event_id, event_id] }, {
    added_count: 0, updated_count: 0, duplicate_count: 1,
  });
  assert.ok(!result.isError);
  const mixed = await invoke({ action: 'add', policy_id, event_ids: [event_id, '00000000-0000-4000-8000-000000000402'] }, {
    added_count: 1, updated_count: 1, duplicate_count: 0,
  });
  assert.ok(!mixed.isError);
});
