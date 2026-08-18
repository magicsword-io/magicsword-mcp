import { z } from 'zod';
import { defineTool, formatApiError, textError, textOk } from './shared.js';

export const upgradeEndpointsTool = defineTool({
  name: 'upgrade_endpoints',
  title: 'Queue MagicSword agent upgrades',
  description:
    'Previews or queues agent upgrades for one endpoint, explicit endpoint IDs, all endpoints on a platform, or endpoints matching a hostname glob. ' +
    'The first call previews the request; rerun with confirm=true after human approval. Requires endpoints:write.',
  inputSchema: {
    endpoint_id: z.string().uuid().optional().describe('Single endpoint UUID'),
    endpoint_ids: z.array(z.string().uuid()).min(1).max(500).optional().describe('Explicit endpoint UUIDs'),
    hostname_pattern: z.string().min(1).max(255).optional().describe('Optional hostname glob resolved server-side'),
    platform: z.enum(['windows', 'macos', 'linux']).optional().describe('Optional platform filter'),
    target_version: z.string().min(1).max(100).optional().describe('Target version, or latest by default'),
    update_all_outdated: z.boolean().optional().describe('Skip endpoints already on the target version'),
    limit: z.number().int().min(1).max(500).optional().describe('Max endpoints to resolve for filters'),
    confirm: z.boolean().optional().describe('Set true only after a human approves the preview'),
  },
  async handler(
    { endpoint_id, endpoint_ids, hostname_pattern, platform, target_version, update_all_outdated, limit, confirm },
    { client },
  ) {
    try {
      const selectors = [
        Boolean(endpoint_id),
        Boolean(endpoint_ids?.length),
        Boolean(hostname_pattern),
        Boolean(platform),
      ];
      if (selectors.filter(Boolean).length === 0) {
        return textError('Provide endpoint_id, endpoint_ids, hostname_pattern, or platform.');
      }
      if (endpoint_id && selectors.filter(Boolean).length > 1) {
        return textError('endpoint_id cannot be combined with other endpoint selectors.');
      }
      if (endpoint_ids?.length && (hostname_pattern || platform)) {
        return textError('endpoint_ids cannot be combined with hostname_pattern or platform.');
      }

      if (confirm !== true) {
        return textOk('PREVIEW — no upgrades were queued. Re-run with confirm=true after human approval.', {
          requires_confirmation: true,
          selector: { endpoint_id, endpoint_ids, hostname_pattern, platform, limit },
          target_version: target_version ?? 'latest',
          update_all_outdated: update_all_outdated ?? true,
        });
      }

      if (endpoint_id) {
        const result = await client.upgradeEndpoint(endpoint_id, target_version ?? 'latest');
        return textOk(`Queued upgrade for endpoint ${endpoint_id}.`, result as Record<string, unknown>);
      }

      let ids = endpoint_ids ?? [];
      if (hostname_pattern) {
        const page = await client.endpoints({
          platform,
          hostname_pattern,
          limit: limit ?? 500,
        });
        if (page.total > page.endpoints.length) {
          return textError(
            `Hostname pattern matched ${page.total} endpoints but only ${page.endpoints.length} fit the requested limit. ` +
              'Increase limit up to 500 or narrow the pattern; no upgrades were queued.',
          );
        }
        ids = page.endpoints.map((endpoint) => endpoint.id);
        if (ids.length === 0) {
          return textOk(
            `No endpoints matched hostname_pattern "${hostname_pattern}"${platform ? ` on ${platform}` : ''}. No upgrades were queued.`,
            { results: [], queued: 0, skipped: 0, failed: 0 },
          );
        }
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
