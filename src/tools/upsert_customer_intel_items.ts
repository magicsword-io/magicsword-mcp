import { z } from 'zod';
import { defineTool, formatApiError, textError, textOk } from './shared.js';

const intelItemSchema = z.record(z.unknown()).describe(
  'One indicator. Supported fields include filename/file_name, filepath/file_path/path, hash/file_hash, authentihash, pagehash/page_file_hash, tbs_hash with publisher.',
);

export const upsertCustomerIntelItemsTool = defineTool({
  name: 'upsert_customer_intel_items',
  title: 'Add or update indicators in a private intel feed',
  description:
    'Bulk upserts up to 100 indicators into a private feed. This is the MCP path for “extract IOCs from this report and add them to MagicSword.” Requires intel:write.',
  inputSchema: {
    feed_id: z.string().min(1).describe('Private feed UUID'),
    items: z.array(intelItemSchema).min(1).max(100).describe('Indicators to upsert'),
  },
  async handler({ feed_id, items }, { client }) {
    if (items.length === 0) return textError('items must not be empty.');
    try {
      const result = await client.upsertIntelFeedItems(feed_id, items);
      return textOk(`Upserted ${items.length} indicator(s) into feed ${feed_id}.`, result as Record<string, unknown>);
    } catch (err) {
      return formatApiError(err);
    }
  },
});
