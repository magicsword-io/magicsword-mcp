import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const policy_id = '00000000-0000-4000-8000-000000000101';
const event_id = '00000000-0000-4000-8000-000000000401';
const filenames = ['rustdesk.exe', 'mshta.exe', 'wscript.exe'];
const rules = filenames.map(value => ({ type: 'filename', value, status: 'blocked' }));

for (const mode of ['auto', 'legacy']) {
  test(`RULES-04 explicit filename round trip over real ${mode} MCP stdio and HTTP`, { timeout: 30000 }, async () => {
    const requests = [];
    const stored = [{ type: 'filename', value: 'baseline.exe', status: 'blocked', source: 'feed' }];
    let version = 1;
    let override;
    const server = createServer(async (request, response) => {
      try {
        let text = '';
        for await (const chunk of request) text += chunk;
        const body = text ? JSON.parse(text) : undefined;
        requests.push({ method: request.method, url: request.url, body });
        assert.equal(request.headers.authorization, 'Bearer msk_test_policy_rules_1234567890');
        response.setHeader('content-type', 'application/json');
        if (request.method === 'GET') {
          const url = new URL(request.url, 'http://localhost');
          assert.equal(url.pathname, `/api/public/v1/policies/${policy_id}/rules`);
          const offset = Number(url.searchParams.get('offset') ?? 0);
          const limit = Number(url.searchParams.get('limit') ?? 100);
          response.end(JSON.stringify({ rules: stored.slice(offset, offset + limit), total: stored.length, version, limit, offset }));
          return;
        }
        assert.ok([`/api/public/v1/policies/${policy_id}/rules`, '/api/public/v1/policies/rules'].includes(request.url));
        if (override !== undefined) {
          response.end(JSON.stringify(override));
          return;
        }
        const inputs = body.rules ?? [{ type: 'filename', value: 'event.exe', status: body.status }];
        let added_count = 0, updated_count = 0, duplicate_count = 0;
        for (const rule of inputs) {
          const existing = stored.find(item => item.type === rule.type && item.value === rule.value);
          if (!existing) { stored.push({ ...rule, source: 'customer_api' }); added_count++; }
          else if (existing.status !== rule.status) { existing.status = rule.status; updated_count++; }
          else duplicate_count++;
        }
        if (added_count + updated_count > 0) version++;
        response.end(JSON.stringify({ success: true, added_count, updated_count, duplicate_count, version }));
      } catch (error) {
        response.statusCode = 500;
        response.end(JSON.stringify({ error: String(error) }));
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const client = new Client({ name: 'policy-rules-regression', version: '1.0.0' }, { versionNegotiation: { mode } });
    const transport = new StdioClientTransport({
      command: process.execPath, args: [join(process.cwd(), 'dist/index.js')],
      env: { ...process.env, MAGICSWORD_API_KEY: 'msk_test_policy_rules_1234567890',
        MAGICSWORD_BASE_URL: `http://127.0.0.1:${server.address().port}`,
        MAGICSWORD_CONFIG: join(tmpdir(), 'magicsword-policy-rules-missing.json') },
    });
    const call = args => client.callTool({ name: 'manage_policy_rules', arguments: args });
    try {
      await client.connect(transport);
      const added = await call({ action: 'add', policy_id, rules });
      assert.ok(!added.isError, JSON.stringify(added));
      assert.equal(added.structuredContent.added_count, 3);
      assert.match(added.content[0].text, /added 3/);
      assert.deepEqual(requests[0].body, { policy_id, rules });
      const listed = await call({ action: 'list', policy_id, limit: 2, offset: 1 });
      assert.ok(!listed.isError);
      assert.equal(listed.structuredContent.total, 4);
      assert.deepEqual(listed.structuredContent.rules, stored.slice(1, 3));
      assert.equal(stored[0].source, 'feed');
      const repeated = await call({ action: 'add', policy_name: 'Workstations', platform: 'windows', rules });
      assert.ok(!repeated.isError);
      assert.match(repeated.content[0].text, /No changes/);
      assert.equal(version, 2);
      assert.equal(requests.at(-1).url, '/api/public/v1/policies/rules');
      const updated = await call({ action: 'add', policy_id, rules: [{ ...rules[0], status: 'allowed' }] });
      assert.ok(!updated.isError);
      assert.match(updated.content[0].text, /updated 1/);
      const events = await call({ action: 'add', policy_id, event_ids: [event_id], type: 'filename', status: 'allowed' });
      assert.ok(!events.isError);
      assert.deepEqual(requests.at(-1).body, { policy_id, event_ids: [event_id], type: 'filename', status: 'allowed' });
      const before = requests.length;
      for (const args of [
        { rules: [{}] }, { rules: [{ ...rules[0], file_name: 'ignored.exe' }] },
        { rules, event_ids: [] }, { rules, event_ids: [event_id] }, { rules, status: 'allowed' },
      ]) {
        try {
          const result = await call({ action: 'add', policy_id, ...args });
          assert.equal(result.isError, true);
        } catch (error) {
          // Some protocol versions surface schema rejection as JSON-RPC errors.
          assert.match(error.message, /valid|param|schema/i);
        }
      }
      assert.equal(requests.length, before, 'invalid inputs reached HTTP');
      for (const invalid of [{ added_count: 0, updated_count: 0, duplicate_count: 0 }, { added_count: 0, duplicate_count: 1 }, { success: true }, { added_count: '3' }]) {
        override = invalid;
        const beforeWrite = requests.length;
        const result = await call({ action: 'add', policy_id, rules });
        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /before retrying/);
        assert.equal(requests.length, beforeWrite + 1, 'write was retried');
      }
    } finally {
      await client.close();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
}
