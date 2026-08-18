import { z } from 'zod';
import { defineTool, formatApiError, textError, textOk } from './shared.js';

const platformSchema = z.enum(['windows', 'macos', 'linux']);

export const manageCustomerIntelFeedTool = defineTool({
  name: 'manage_customer_intel_feed',
  title: 'Create, edit, or delete a private intel feed',
  description:
    'Creates, updates, or deletes private intelligence feeds. Organizations are limited to 3 feeds. Requires intel:write.',
  inputSchema: {
    action: z.enum(['create', 'update', 'delete']).describe('Feed operation'),
    feed_id: z.string().uuid().optional().describe('Required for update/delete'),
    name: z.string().min(1).max(255).optional().describe('Feed name for create/update'),
    description: z.string().max(4096).optional().describe('Optional feed description'),
    platforms: z.array(platformSchema).optional().describe('Platforms this feed applies to'),
    is_enabled: z.boolean().optional().describe('Enable/disable matching for this feed'),
    confirm: z.boolean().optional().describe('Required for delete after a human approves the preview'),
  },
  async handler({ action, feed_id, name, description, platforms, is_enabled, confirm }, { client }) {
    try {
      if (action === 'create') {
        if (!name) return textError('name is required when action=create.');
        const result = await client.createIntelFeed({
          name,
          description,
          platforms,
          is_enabled,
        });
        return textOk(`Created private intel feed "${name}".`, result as Record<string, unknown>);
      }
      if (!feed_id) return textError(`feed_id is required when action=${action}.`);
      if (action === 'delete') {
        if (confirm !== true) {
          return textOk(
            `PREVIEW — would delete private intel feed ${feed_id}. No changes were made. ` +
              'Re-run with confirm=true after human approval.',
            { feed_id, would_delete: true, requires_confirmation: true },
          );
        }
        const result = await client.deleteIntelFeed(feed_id);
        return textOk(`Deleted private intel feed ${feed_id}.`, result as Record<string, unknown>);
      }
      const result = await client.updateIntelFeed(feed_id, {
        name,
        description,
        platforms,
        is_enabled,
      });
      return textOk(`Updated private intel feed ${feed_id}.`, result as Record<string, unknown>);
    } catch (err) {
      return formatApiError(err);
    }
  },
});
