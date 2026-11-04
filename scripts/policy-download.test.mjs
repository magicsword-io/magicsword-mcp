import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import { z } from 'zod';
import { MagicSwordClient } from '../dist/client.js';
import { validatePolicyDownload, savePolicyDownload, policyDownloadDirectory, POLICY_DOWNLOAD_MAX_BYTES } from '../dist/policy-download.js';
import { downloadPolicyTool as tool } from '../dist/tools/download_policy.js';
import { annotationsForTool } from '../dist/tools/index.js';

const policyId = '00000000-0000-4000-8000-000000000001';
const versionId = '00000000-0000-4000-8000-000000000002';
const xml = Buffer.from('<?xml version="1.0" encoding="utf-8"?><SiPolicy xmlns="urn:schemas-microsoft-com:sipolicy"><PolicyID>{00000000-0000-4000-8000-000000000003}</PolicyID></SiPolicy>');
const applocker = Buffer.from('<?xml version="1.0" encoding="utf-8"?><AppLockerPolicy Version="1"><RuleCollection Type="Exe" EnforcementMode="AuditOnly"/></AppLockerPolicy>');
const zip = Buffer.from(zipSync({ 'base.xml': xml, 'intel.xml': xml }));
const headers = format => ({ 'content-type': format === 'wdac' ? 'application/zip' : 'application/xml; charset=utf-8',
  'x-magicsword-policy-version-id': versionId, 'x-magicsword-policy-xml-file-count': format === 'wdac' ? '2' : '1',
  'x-magicsword-applocker-projection-summary': '{"totalRules":2,"omitted":1}' });
const invoke = (args, client) => tool.handler(z.strictObject(tool.inputSchema).parse(args), { client });

test('DOWNLOAD-001 strict input and output directories reject malformed/unrequested options', () => {
  assert.equal(z.strictObject(tool.inputSchema).parse({ policy_id: policyId }).format, 'wdac');
  for (const args of [{ format: 'zip' }, { policy_id: '../foreign' }, { organization_id: policyId }, { overwrite: true }]) {
    assert.equal(z.strictObject(tool.inputSchema).safeParse({ policy_id: policyId, ...args }).success, false);
  }
  assert.equal(policyDownloadDirectory(), join(homedir(), 'Downloads'));
  assert.equal(policyDownloadDirectory('~/Downloads'), join(homedir(), 'Downloads'));
  for (const path of ['', '../Downloads', 'Downloads', '~/bad\nname']) assert.throws(() => policyDownloadDirectory(path));
  assert.deepEqual(annotationsForTool('download_policy'), { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
});

test('DOWNLOAD-002 validates complete WDAC archive and AppLocker XML with metadata and exact hash', () => {
  for (const [format, bytes] of [['wdac', zip], ['applocker', applocker]]) {
    const result = validatePolicyDownload(bytes, format, headers(format));
    assert.equal(result.versionId, versionId);
    assert.equal(result.fileCount, format === 'wdac' ? 2 : 1);
    assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(result.bytes, bytes);
    assert.equal(result.projectionSummary.omitted, 1);
  }
});

test('DOWNLOAD-003 rejects wrong MIME, version, HTML, malformed XML, DTD, wrong root, invalid UTF8 and truncated ZIP', () => {
  for (const [bytes, format, overrides] of [
    [zip, 'wdac', { 'content-type': 'text/html' }], [zip, 'wdac', { 'x-magicsword-policy-version-id': 'bad' }],
    [zip, 'wdac', { 'x-magicsword-policy-xml-file-count': '1' }], [Buffer.from('<html>login</html>'), 'applocker', {}],
    [Buffer.from('<AppLockerPolicy><RuleCollection></AppLockerPolicy>'), 'applocker', {}],
    [Buffer.from('<!DOCTYPE AppLockerPolicy [<!ENTITY x SYSTEM "file:///etc/passwd">]><AppLockerPolicy>&x;</AppLockerPolicy>'), 'applocker', {}],
    [Buffer.from([0xff]), 'applocker', {}], [zip.subarray(0, zip.length - 10), 'wdac', {}],
    [Buffer.from('<AppLockerPolicy/><html/>'), 'applocker', {}], [Buffer.from(''), 'applocker', {}],
  ]) assert.throws(() => validatePolicyDownload(bytes, format, { ...headers(format), ...overrides }));
});

test('DOWNLOAD-004 rejects unsafe/non-XML archive members and expansion limits before allocation', () => {
  for (const name of ['../evil.xml', '/evil.xml', 'C:\\evil.xml', 'payload.ps1', 'folder/base.xml']) {
    const bytes = Buffer.from(zipSync({ [name]: xml }));
    assert.throws(() => validatePolicyDownload(bytes, 'wdac', { ...headers('wdac'), 'x-magicsword-policy-xml-file-count': '1' }));
  }
  const duplicate = Buffer.from(zipSync({ 'base.xml': xml, 'BASE.xml': xml }));
  assert.throws(() => validatePolicyDownload(duplicate, 'wdac', headers('wdac')));
  const oversized = Buffer.from(zip);
  const central = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(central >= 0);
  oversized.writeUInt32LE(31 * 1024 * 1024, central + 24);
  assert.throws(() => validatePolicyDownload(oversized, 'wdac', headers('wdac')));
  assert.throws(() => validatePolicyDownload(Buffer.alloc(POLICY_DOWNLOAD_MAX_BYTES + 1), 'applocker', headers('applocker')));
});

test('DOWNLOAD-010 rejects multiple XML roots, CRC corruption and forged uncompressed lengths', () => {
  for (const xmlText of ['<SiPolicy></SiPolicy><evil/>', '<SiPolicy/><SiPolicy/>', '<SiPolicy/>evil']) {
    const bytes = Buffer.from(zipSync({ 'base.xml': strToU8(xmlText) }));
    assert.throws(() => validatePolicyDownload(bytes, 'wdac', { ...headers('wdac'), 'x-magicsword-policy-xml-file-count': '1' }));
  }
  for (const text of ['<AppLockerPolicy/><AppLockerPolicy/>', '<AppLockerPolicy/><evil/>']) {
    assert.throws(() => validatePolicyDownload(Buffer.from(text), 'applocker', headers('applocker')));
  }
  const original = Buffer.from('<SiPolicy></SiPolicy>evil');
  const forged = Buffer.from(zipSync({ 'base.xml': original }));
  const central = forged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  // Forge both declared lengths so a truncating inflater would validate only the XML prefix.
  forged.writeUInt32LE(21, central + 24); forged.writeUInt32LE(21, 22);
  assert.throws(() => validatePolicyDownload(forged, 'wdac', { ...headers('wdac'), 'x-magicsword-policy-xml-file-count': '1' }));
  const corrupt = Buffer.from(zipSync({ 'base.xml': xml }, { level: 0 }));
  const position = corrupt.indexOf(Buffer.from('PolicyID'));
  assert.ok(position > 0);
  // Keep XML well formed while changing the actual artifact relative to its CRC.
  corrupt[position] = 'p'.charCodeAt(0); corrupt[corrupt.lastIndexOf(Buffer.from('PolicyID'))] = 'p'.charCodeAt(0);
  assert.throws(() => validatePolicyDownload(corrupt, 'wdac', { ...headers('wdac'), 'x-magicsword-policy-xml-file-count': '1' }));
});

test('DOWNLOAD-005 exclusive local save preserves bytes, private mode, existing files and final-path symlinks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'magicsword-download-save-'));
  try {
    const download = validatePolicyDownload(zip, 'wdac', headers('wdac'));
    const path = await savePolicyDownload(download, policyId, directory);
    assert.deepEqual(await readFile(path), zip);
    if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
    const second = await savePolicyDownload(download, policyId, directory);
    assert.notEqual(path, second);
    assert.deepEqual(await readFile(path), zip);
    const target = join(directory, 'keep.txt');
    await writeFile(target, 'keep');
    await rm(path);
    // Windows symlink creation may require elevation; existing regular-file protection ran above.
    if (process.platform !== 'win32') {
      await symlink(target, path);
      const third = await savePolicyDownload(download, policyId, directory);
      assert.notEqual(third, path);
      assert.equal(await readFile(target, 'utf8'), 'keep');
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('DOWNLOAD-006 tool writes only a validated download, reports path/hash and AppLocker omissions, no install', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'magicsword-download-tool-'));
  try {
    for (const [format, bytes] of [['wdac', zip], ['applocker', applocker]]) {
      const download = validatePolicyDownload(bytes, format, headers(format));
      const result = await invoke({ policy_id: policyId, format, output_directory: directory }, {
        downloadPolicy: async (id, f) => { assert.equal(id, policyId); assert.equal(f, format); return download; },
      });
      assert.ok(!result.isError, result.content[0].text);
      assert.deepEqual(await readFile(result.structuredContent.path), bytes);
      assert.equal(result.structuredContent.sha256, download.sha256);
      assert.match(result.content[0].text, /Nothing was installed or assigned/);
      if (format === 'applocker') assert.match(result.content[0].text, /omitted rules/);
    }
    const before = await readdir(directory);
    const failed = await invoke({ policy_id: policyId, output_directory: directory }, {
      downloadPolicy: async () => { throw new Error('secret msk_do_not_log'); },
    });
    assert.equal(failed.isError, true);
    assert.doesNotMatch(JSON.stringify(failed), /msk_do_not_log/);
    assert.deepEqual(await readdir(directory), before);
    const invalidDirectory = await invoke({ policy_id: policyId, output_directory: 'relative' }, {
      downloadPolicy: async () => { assert.fail('invalid local path should fail before HTTP'); },
    });
    assert.equal(invalidDirectory.isError, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function httpFixture(handler, run) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const client = new MagicSwordClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: 'msk_fixture_download_only', getRetries: 2 });
  try { await run(client, server); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('DOWNLOAD-007 binary HTTP streams preserve authenticated artifact bytes for both formats', async () => {
  await httpFixture((request, response) => {
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.authorization, 'Bearer msk_fixture_download_only');
    const url = new URL(request.url, 'http://localhost');
    assert.equal(url.pathname, `/api/public/v1/policies/${policyId}/download`);
    const format = url.searchParams.get('format');
    assert.ok(['wdac', 'applocker'].includes(format));
    response.writeHead(200, { ...headers(format), 'content-disposition': 'attachment; filename="../../evil.ps1"' });
    const bytes = format === 'wdac' ? zip : applocker;
    response.write(bytes.subarray(0, 7));
    response.end(bytes.subarray(7));
  }, async client => {
    assert.deepEqual((await client.downloadPolicy(policyId)).bytes, zip);
    assert.deepEqual((await client.downloadPolicy(policyId, 'applocker')).bytes, applocker);
  });
});

test('DOWNLOAD-008 denied/raced/too-large/transient downloads are not retried or written; errors sanitized', async () => {
  for (const status of [401, 403, 404, 409, 413, 422, 503]) {
    let requests = 0;
    await httpFixture((request, response) => {
      requests++;
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end('{"error":"secret msk_do_not_log"}');
    }, async client => {
      const result = await invoke({ policy_id: policyId, output_directory: join(tmpdir(), 'unused-download-output') }, client);
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, new RegExp(`HTTP ${status}`));
      assert.doesNotMatch(JSON.stringify(result), /msk_do_not_log/);
      assert.equal(requests, 1);
    });
  }
});

test('DOWNLOAD-009 redirect cannot send the key to another origin', async () => {
  let leaked = 0;
  const target = createServer((_request, response) => { leaked++; response.end('bad'); });
  target.listen(0, '127.0.0.1'); await once(target, 'listening');
  try {
    await httpFixture((_request, response) => {
      response.writeHead(302, { location: `http://127.0.0.1:${target.address().port}/steal` }); response.end();
    }, async client => { await assert.rejects(() => client.downloadPolicy(policyId)); });
    assert.equal(leaked, 0);
  } finally { target.closeAllConnections(); await new Promise(resolve => target.close(resolve)); }
});


test('DOWNLOAD-014 streamed oversized HTTP response is aborted before validation or filesystem writes', async () => {
  let requests = 0;
  await httpFixture((_request, response) => {
    requests++;
    response.writeHead(200, headers('wdac'));
    const chunk = Buffer.alloc(1024 * 1024, 32);
    for (let n = 0; n < 33; n++) response.write(chunk);
    response.end();
  }, async client => {
    await assert.rejects(() => client.downloadPolicy(policyId), /32 MiB size limit/);
    assert.equal(requests, 1);
  });
});
