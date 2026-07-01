import { z } from 'zod';
import { defineTool, formatApiError, globToRegex, textError, textOk } from './shared.js';

export const upgradeEndpointsTool = defineTool({
  name: 'upgrade_endpoints',
  title: 'Queue MagicSword agent upgrades',
  description:
    'Queues agent upgrades for one endpoint, explicit endpoint IDs, all endpoints on a platform, or endpoints matching a hostname glob. Requires endpoints:write.',
  inputSchema: {
    endpoint_id: z.string().optional().describe('Single endpoint UUID'),
    endpoint_ids: z.array(z.string().min(1)).optional().describe('Explicit endpoint UUIDs'),
    hostname_pattern: z.string().optional().describe('Optional hostname glob resolved client-side'),
    platform: z.enum(['windows', 'macos', 'linux']).optional().describe('Optional platform filter'),
    target_version: z.string().optional().describe('Target version, or latest by default'),
    update_all_outdated: z.boolean().optional().describe('Skip endpoints already on the target version'),
    limit: z.number().int().min(1).max(500).optional().describe('Max endpoints to resolve for filters'),
  },
  async handler({ endpoint_id, endpoint_ids, hostname_pattern, platform, target_version, update_all_outdated, limit }, { client }) {
    try {
      if (endpoint_id) {
        const result = await client.upgradeEndpoint(endpoint_id, target_version ?? 'latest');
        return textOk(`Queued upgrade for endpoint ${endpoint_id}.`, result as Record<string, unknown>);
      }

      let ids = endpoint_ids ?? [];
      if (hostname_pattern) {
        const re = globToRegex(hostname_pattern);
        const page = await client.endpoints({ platform, limit: limit ?? 500 });
        ids = page.endpoints.filter((endpoint) => endpoint.computer_name && re.test(endpoint.computer_name)).map((endpoint) => endpoint.id);
        if (ids.length === 0) {
          return textOk(
            `No endpoints matched hostname_pattern "${hostname_pattern}"${platform ? ` on ${platform}` : ''}. No upgrades were queued.`,
            { results: [], queued: 0, skipped: 0, failed: 0 },
          );
        }
      }

      if (ids.length === 0 && !platform) {
        return textError('Provide endpoint_id, endpoint_ids, hostname_pattern, or platform.');
      }

      const result = await client.bulkUpgradeEndpoints({
        endpoint_ids: ids.length ? ids : undefined,
        platform,
        target_version: target_version ?? 'latest',
        update_all_outdated: update_all_outdated ?? true,
        all: ids.length === 0 && !!platform,
        limit,
      });
      return textOk('Queued endpoint upgrade request.', result as Record<string, unknown>);
    } catch (err) {
      return formatApiError(err);
    }
  },
});
