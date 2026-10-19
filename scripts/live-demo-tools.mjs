// Opt-in live checks for disposable feed/item writes and endpoint-action previews.
// Requires the same unassigned audit fixture as live-policy-rules.mjs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { loadConfig } from '../dist/config.js';

if (process.env.MAGICSWORD_LIVE_TEST !== '1' || !process.env.MAGICSWORD_TEST_POLICY_ID) {
  throw new Error('Set MAGICSWORD_LIVE_TEST=1 and MAGICSWORD_TEST_POLICY_ID to a disposable, unassigned Windows audit policy.');
}
const policy_id = process.env.MAGICSWORD_TEST_POLICY_ID;
const config = loadConfig();
const client = new Client({ name: 'magicsword-live-demo-tools', version: '1.0.0' }, {
  versionNegotiation: { mode: process.env.MAGICSWORD_TEST_PROTOCOL === 'legacy' ? 'legacy' : 'auto' },
});
const transport = new StdioClientTransport({
  command: process.execPath, args: [join(process.cwd(), 'dist/index.js')],
  env: { ...process.env, MAGICSWORD_API_KEY: config.apiKey, MAGICSWORD_BASE_URL: config.baseUrl,
    MAGICSWORD_CONFIG: join(tmpdir(), 'magicsword-live-missing.json') },
  stderr: 'pipe',
});
let feed_id;
let attachAttempted = false;
let assertions = 0;
function check(condition, label) {
  assert.ok(condition, label);
  assertions++;
  console.log(`PASS ${label}`);
}
async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  assert.ok(!result.isError, `${name} failed (response withheld)`);
  return result.structuredContent;
}
try {
  await client.connect(transport);
  const policy = await call('show_policy', { policy_id });
  check(policy.platform === 'windows' && policy.current_version?.status === 'audit'
    && policy.current_version.name.startsWith('MCP issue 5 disposable verification'), 'disposable Windows audit fixture verified');
  let endpoint;
  for (let offset = 0; ; offset += 500) {
    const page = await call('list_endpoints', { limit: 500, offset });
    endpoint ??= page.endpoints[0];
    assert.ok(page.endpoints.every(e => e.policy_id !== policy_id && e.macos_policy_id !== policy_id && !e.desired_policy_ids?.includes(policy_id)));
    if (offset + page.endpoints.length >= page.total) break;
    assert.ok(page.endpoints.length > 0);
  }
  check(true, 'fixture is unassigned across all endpoint pages');
  if (endpoint) {
    const preview = await call('apply_policy_to_endpoints', { policy_id, endpoint_ids: [endpoint.id] });
    check(preview.requires_confirmation === true, 'assignment remains a preview without confirmation');
    const upgrade = await call('upgrade_endpoints', { endpoint_id: endpoint.id });
    check(upgrade.requires_confirmation === true, 'upgrade remains a preview without confirmation');
  }
  await call('flip_to_enforcing', { policy_id });
  const afterPreview = await call('show_policy', { policy_id });
  check(afterPreview.current_version.id === policy.current_version.id && afterPreview.current_version.status === 'audit', 'enforcement preview leaves the audit version unchanged');
  for (const platform of ['windows', 'macos', 'linux']) {
    await call('agent_install_instructions', { platform });
  }
  check(true, 'installer instructions render for all three platforms');

  const sourcesBefore = await call('manage_policy_intel_sources', { action: 'list', policy_id });
  const created = await call('manage_customer_intel_feed', { action: 'create',
    name: `MCP disposable verification ${randomUUID()}`, platforms: ['windows'], is_enabled: false,
    description: 'Disposable MCP integration verification; disabled and removed by the test.' });
  feed_id = created.feed.id;
  check(created.feed.is_enabled === false, 'temporary intelligence feed is created disabled');
  const updated = await call('manage_customer_intel_feed', { action: 'update', feed_id, description: 'Disposable MCP integration verification updated.' });
  check(updated.feed.description === 'Disposable MCP integration verification updated.', 'feed metadata update persists');
  const upserted = await call('upsert_customer_intel_items', { feed_id, items: [{ filename: 'mcp-disposable-verification.exe' }] });
  let items = await call('list_customer_intel_feeds', { feed_id });
  check(upserted.created === 1 && items.total === 1
    && items.items[0].data.fileName?.[0] === 'mcp-disposable-verification.exe', 'upserted indicator is listed in normalized form');
  const repeated = await call('upsert_customer_intel_items', { feed_id, items: [{ filename: 'mcp-disposable-verification.exe' }] });
  check(repeated.created === 0 && repeated.updated === 1, 'repeated indicator upsert updates rather than duplicates');
  const item_id = items.items[0].id;
  await call('manage_customer_intel_item', { action: 'update', feed_id, item_id,
    item: { filename: 'mcp-disposable-verification-updated.exe' } });
  items = await call('list_customer_intel_feeds', { feed_id });
  check(items.total === 1 && items.items[0].data.fileName?.[0] === 'mcp-disposable-verification-updated.exe', 'indicator update persists without duplication');
  const deletePreview = await call('manage_customer_intel_item', { action: 'delete', feed_id, item_id });
  items = await call('list_customer_intel_feeds', { feed_id });
  check(deletePreview.requires_confirmation === true && items.total === 1, 'indicator deletion preview leaves the item intact');
  await call('manage_customer_intel_item', { action: 'delete', feed_id, item_id, confirm: true });
  items = await call('list_customer_intel_feeds', { feed_id });
  check(items.total === 0, 'confirmed indicator deletion removes the item');

  attachAttempted = true;
  await call('manage_policy_intel_sources', { action: 'attach', policy_id, source_id: feed_id });
  const attached = await call('manage_policy_intel_sources', { action: 'list', policy_id });
  check(attached.sources.some(source => source.id === feed_id), 'temporary feed attaches to the disposable policy');
  await call('manage_policy_intel_sources', { action: 'detach', policy_id, source_id: feed_id });
  attachAttempted = false;
  const detached = await call('manage_policy_intel_sources', { action: 'list', policy_id });
  check(JSON.stringify(detached.sources.map(s => s.id).sort()) === JSON.stringify(sourcesBefore.sources.map(s => s.id).sort()), 'detach restores the original source set');
  const feedPreview = await call('manage_customer_intel_feed', { action: 'delete', feed_id });
  const feeds = await call('list_customer_intel_feeds', { limit: 500 });
  check(feedPreview.requires_confirmation === true && feeds.feeds.some(feed => feed.id === feed_id), 'feed deletion preview leaves the feed intact');
} catch (error) {
  console.error(String(error).replaceAll(config.apiKey, '[REDACTED]'));
  process.exitCode = 1;
} finally {
  if (feed_id && attachAttempted) {
    try {
      const sources = await call('manage_policy_intel_sources', { action: 'list', policy_id });
      if (sources.sources.some(source => source.id === feed_id)) {
        await call('manage_policy_intel_sources', { action: 'detach', policy_id, source_id: feed_id });
      }
    } catch (error) {
      console.error(`Detach cleanup failed: ${String(error).replaceAll(config.apiKey, '[REDACTED]')}`);
      process.exitCode = 1;
    }
  }
  try {
    if (feed_id) {
      await call('manage_customer_intel_feed', { action: 'delete', feed_id, confirm: true });
      const feeds = await call('list_customer_intel_feeds', { limit: 500 });
      check(!feeds.feeds.some(feed => feed.id === feed_id), 'temporary feed cleanup verified');
    }
  } catch (error) {
    console.error(`Cleanup failed: ${String(error).replaceAll(config.apiKey, '[REDACTED]')}`);
    process.exitCode = 1;
  }
  await client.close();
}
if (!process.exitCode) console.log(`Live demo-tool checks passed: ${assertions} assertions.`);
