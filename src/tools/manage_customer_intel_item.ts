import { z } from 'zod';
import { defineTool, formatApiError, textError, textOk } from './shared.js';

export const manageCustomerIntelItemTool = defineTool({
  name: 'manage_customer_intel_item',
  title: 'Edit or delete a customer intel feed item',
  description:
    'Edits or deletes one item in a customer-owned intelligence feed. Requires intel:write.',
  inputSchema: {
    action: z.enum(['update', 'delete']),
    feed_id: z.string().min(1),
    item_id: z.string().min(1),
    item: z.record(z.unknown()).optional()
      .describe('Replacement/merge fields for update. Supported fields match upsert_customer_intel_items.'),
  },
  async handler({ action, feed_id, item_id, item }, { client }) {
    try {
      if (action === 'delete') {
        const result = await client.deleteIntelFeedItem(feed_id, item_id);
        return textOk(`Deleted item ${item_id} from feed ${feed_id}.`, result as Record<string, unknown>);
      }
      if (!item) return textError('item is required when action=update.');
      const result = await client.updateIntelFeedItem(feed_id, item_id, item);
      return textOk(`Updated item ${item_id} in feed ${feed_id}.`, result as Record<string, unknown>);
    } catch (err) {
      return formatApiError(err);
    }
  },
});
