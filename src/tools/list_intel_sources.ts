import { z } from 'zod';
import { defineTool, formatApiError, textOk } from './shared.js';

export const listIntelSourcesTool = defineTool({
  name: 'list_intel_sources',
  title: 'List available intelligence sources',
  description:
    'Discovers global and organization-owned intelligence sources and their IDs for attaching to a policy. ' +
    'Returns enabled sources by default; is_enabled=false lists disabled sources. Filter by the policy platform. ' +
    'Use list_policies to find the policy ID, then manage_policy_intel_sources action=list to inspect attachments ' +
    'or action=attach with the selected source_ids. Premium sources may require a paid plan. Requires intel:read.',
  inputSchema: {
    platform: z.enum(['windows', 'macos', 'linux']).optional(),
    is_enabled: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).max(1_000_000).optional(),
  },
  async handler(args, { client }) {
    try {
      const result = await client.intelSources(args);
      const lines = result.sources.map(source =>
        `- ${source.name} — id: ${source.id}; ${source.scope === 'organization' ? 'organization-owned' : 'global'}; ` +
        `${source.item_count ?? 0} items; platforms: ${source.platforms?.join(', ') || 'unspecified'}; ` +
        `enabled: ${source.is_enabled}; premium: ${source.is_premium}`,
      );
      return textOk(
        `Found ${result.total} intelligence source(s). Showing ${result.sources.length} at offset ${result.offset}.` +
        (lines.length ? `\n\n${lines.join('\n')}` : ''),
        result as unknown as Record<string, unknown>,
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
});
