import { z } from 'zod';
import { defineTool, formatApiError, textError, textOk } from './shared.js';

export const manageCustomerIntelItemTool = defineTool({
  name: 'manage_customer_intel_item',
  title: 'Edit or delete a private intel feed item',
  description: 'Edits or deletes one item in a private intelligence feed. Requires intel:write.',
  inputSchema: {
    action: z.enum(['update', 'delete']),
    feed_id: z.string().uuid(),
    item_id: z.string().uuid(),
    item: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Replacement/merge fields for update. Supported fields match upsert_customer_intel_items.'),
    confirm: z.boolean().optional().describe('Required for delete after a human approves the preview'),
  },
  async handler({ action, feed_id, item_id, item, confirm }, { client }) {
    try {
      if (action === 'delete') {
        if (confirm !== true) {
          return textOk(
            `PREVIEW — would delete item ${item_id} from feed ${feed_id}. No changes were made. ` +
              'Re-run with confirm=true after human approval.',
            { feed_id, item_id, would_delete: true, requires_confirmation: true },
          );
        }
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
