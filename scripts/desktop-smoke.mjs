import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { unzipSync } from 'fflate';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { allTools } from '../dist/tools/index.js';

const root = process.cwd();
const archive = readFileSync(join(root, 'release-assets/magicsword-mcp.mcpb'));
const checksum = readFileSync(join(root, 'release-assets/magicsword-mcp.mcpb.sha256'), 'utf8');
assert.equal(checksum, `${createHash('sha256').update(archive).digest('hex')}  magicsword-mcp.mcpb\n`);
const files = unzipSync(archive);
const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
const pkg = JSON.parse(new TextDecoder().decode(files['package.json']));
assert.equal(manifest.version, pkg.version);
assert.equal(manifest.version, JSON.parse(readFileSync('package.json', 'utf8')).version);
assert.equal(manifest.user_config.api_key.sensitive, true);
assert.equal(manifest.user_config.api_key.required, true);
assert.equal(manifest.user_config.api_key.default, undefined, 'Never ship a default key');
assert.deepEqual(manifest.server.mcp_config.env, {
  MAGICSWORD_API_KEY: '${user_config.api_key}',
  MAGICSWORD_BASE_URL: 'https://www.magicsword.io',
});
assert.deepEqual(manifest.server.mcp_config.args, ['${__dirname}/dist/index.js']);
assert.equal(manifest.server.mcp_config.command, 'node', 'Use the host runtime, not npm/npx');
assert.equal(manifest.compatibility.runtimes.node, '>=22');
assert.equal(pkg.devDependencies, undefined, 'Development dependencies must not ship');
assert.equal(pkg.scripts, undefined, 'Installer must not run npm lifecycle scripts');
const allowed = path => ['manifest.json', 'package.json', 'README.md', 'LICENSE'].includes(path) ||
  ['dist/', 'assets/', 'node_modules/'].some(prefix => path.startsWith(prefix));
for (const name of Object.keys(files)) {
  assert(allowed(name), `Unexpected bundled file: ${name}`);
  assert(!/(?:^|\/)(?:\.env(?:\.|$)|mcp\.json$|credentials\.json$|\.git\/)/i.test(name), 'Credential/developer file in installer');
  assert(!name.startsWith('node_modules/@modelcontextprotocol/client/'), 'Development client in installer');
  assert(!name.startsWith('node_modules/ajv/'), 'Build validator in installer');
}
assert(files[manifest.icon], 'Missing installer icon');
assert(files[manifest.server.entry_point], 'Missing server entry point');

const temporary = mkdtempSync(join(tmpdir(), 'magicsword-desktop-clean-'));
const failures = [];
const requests = [];
const expectedKey = 'msk_desktop_fixture_1234567890';
const fixtureApi = createServer((request, response) => {
  try {
    assert.equal(request.headers.authorization, `Bearer ${expectedKey}`);
    assert.equal(request.method, 'GET', 'Installer smoke must not write');
    requests.push(request.url);
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/public/v1/me') {
      response.end(JSON.stringify({ org: { id: 'fixture-org', name: 'Installer fixture' }, key_id: 'fixture-key', scopes: ['endpoints:read'] }));
    } else if (request.url.startsWith('/api/public/v1/endpoints')) {
      response.end(JSON.stringify({ endpoints: [], total: 0 }));
    } else {
      throw new Error('Unexpected fixture path');
    }
  } catch (error) {
    failures.push(error);
    response.writeHead(500).end('{}');
  }
});

try {
  for (const [name, bytes] of Object.entries(files)) {
    assert(!name.startsWith('/') && !name.split('/').includes('..') && !name.includes('\\'), 'Unsafe ZIP path');
    const target = join(temporary, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  assert(!existsSync(join(temporary, '.magicsword')), 'Candidate includes saved configuration');
  const conflictingConfig = join(temporary, 'conflicting-config.json');
  const conflictingContents = JSON.stringify({ apiKey: 'msk_wrong_fixture_1234567890', baseUrl: 'https://wrong.example' });
  writeFileSync(conflictingConfig, conflictingContents);
  fixtureApi.listen(0, '127.0.0.1');
  await once(fixtureApi, 'listening');
  for (const mode of ['auto', 'legacy']) {
    const client = new Client({ name: 'desktop-installer-smoke', version: '1.0.0' }, { versionNegotiation: { mode } });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: manifest.server.mcp_config.args.map(arg => arg.replace('${__dirname}', temporary)),
      // Use fixture credentials and an absent config path. The SDK preserves
      // safe OS environment variables; no saved MagicSword key is read.
      env: {
        MAGICSWORD_API_KEY: expectedKey,
        MAGICSWORD_BASE_URL: `http://127.0.0.1:${fixtureApi.address().port}`,
        MAGICSWORD_CONFIG: mode === 'auto' ? conflictingConfig : join(temporary, 'absent-config.json'),
      },
    });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map(tool => tool.name).sort(), allTools.map(tool => tool.name).sort());
      assert.equal(tools.find(tool => tool.name === 'whoami')?.annotations?.readOnlyHint, true);
      assert.equal(tools.find(tool => tool.name === 'flip_to_enforcing')?.annotations?.destructiveHint, true);
      for (const name of ['whoami', 'list_endpoints']) {
        const result = await client.callTool({ name, arguments: {} });
        assert(!result.isError, `${name} failed in installed bundle`);
      }
    } finally {
      await client.close();
    }
  }
  assert.deepEqual(failures, []);
  assert.equal(requests.length, 4);
  assert.equal(readFileSync(conflictingConfig, 'utf8'), conflictingContents, 'Installer must not overwrite saved credentials');
  console.log(`Desktop installer smoke passed: ${pkg.version}, ${process.platform}, ${allTools.length} tools, both protocols, read-only fixture calls, environment key precedence`);
} finally {
  fixtureApi.closeAllConnections();
  fixtureApi.close();
  rmSync(temporary, { recursive: true, force: true });
}
