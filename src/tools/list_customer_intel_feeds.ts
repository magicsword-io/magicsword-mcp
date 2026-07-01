import { z } from 'zod';
import { defineTool, formatApiError, textOk } from './shared.js';

export const listCustomerIntelFeedsTool = defineTool({
  name: 'list_customer_intel_feeds',
  title: 'List private intelligence feeds',
  description:
    'Lists private intelligence feeds and, optionally, a page of items for one feed. Requires intel:read.',
  inputSchema: {
    feed_id: z.string().optional().describe('Optional feed UUID. When provided, include feed items.'),
    limit: z.number().int().min(1).max(500).optional().describe('Item/feed page size'),
    offset: z.number().int().min(0).optional().describe('Pagination offset'),
  },
  async handler({ feed_id, limit, offset }, { client }) {
    try {
      if (feed_id) {
        const items = await client.intelFeedItems(feed_id, { limit, offset });
        const lines = items.items.map((item) => `  - ${item.id} ${JSON.stringify(item.data)}`).join('\n');
        return textOk(
          items.items.length === 0
            ? `Feed ${feed_id} has no active items on this page.`
            : `Feed ${feed_id} items:\n${lines}`,
          items as unknown as Record<string, unknown>,
        );
      }

      const feeds = await client.intelFeeds({ limit, offset });
      const lines = feeds.feeds
        .map((feed) => `  - ${feed.name} ${feed.id} (${feed.item_count ?? feed.entry_count ?? 0} items)`)
        .join('\n');
      return textOk(
        feeds.feeds.length === 0 ? 'No private intelligence feeds found.' : `Private feeds:\n${lines}`,
        feeds as unknown as Record<string, unknown>,
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
});
