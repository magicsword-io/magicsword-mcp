import { z } from 'zod';
import { defineTool, formatApiError, textOk } from './shared.js';

export const listEndpointsTool = defineTool({
  name: 'list_endpoints',
  title: 'List MagicSword endpoints',
  description:
    'Lists endpoints (devices) enrolled in the MagicSword org. ' +
    'Filter by platform (windows/macos/linux), status, or hostname pattern (glob: "*", "?"). ' +
    'All filters run server-side before pagination. ' +
    'Returns up to `limit` endpoints (default 100, max 500). Use this to find endpoint IDs for other tools.',
  inputSchema: {
    platform: z.enum(['windows', 'macos', 'linux']).optional().describe('Filter by OS platform'),
    status: z
      .enum(['active', 'inactive', 'disabled', 'uninstalled'])
      .optional()
      .describe('Filter by endpoint lifecycle status'),
    hostname_pattern: z
      .string()
      .min(1)
      .max(255)
      .optional()
      .describe('Glob pattern matched case-insensitively against computer_name (e.g. "prod-*", "win-?-db")'),
    limit: z.number().int().min(1).max(500).optional().describe('Page size (default 100, max 500)'),
    offset: z.number().int().min(0).optional().describe('Skip this many records before returning (for paging)'),
  },
  async handler({ platform, status, hostname_pattern, limit, offset }, { client }) {
    try {
      const page = await client.endpoints({
        platform,
        status,
        hostname_pattern,
        limit,
        offset,
      });
      const endpoints = page.endpoints;
      const summary =
        endpoints.length === 0
          ? `No endpoints matched this page. The filtered result set contains ${page.total} endpoint(s).`
          : `Showing ${endpoints.length} of ${page.total} filtered endpoint(s).\n\n` +
            endpoints
              .map((e) => {
                const lastSeen = e.last_checkin ?? e.last_heartbeat ?? 'never';
                return [
                  `- ${e.computer_name ?? '(unnamed)'} [${e.platform}]`,
                  `    id: ${e.id}`,
                  `    status: ${e.status ?? '(unknown)'} / compliance: ${e.compliance_status ?? '(unknown)'}`,
                  `    policy_id: ${e.policy_id ?? '(none)'}  installer: ${e.installer_version ?? '(unknown)'}`,
                  `    update: ${e.update_status ?? '(none)'}  target: ${e.update_target_version ?? '(none)'}`,
                  `    last_seen: ${lastSeen}`,
                ].join('\n');
              })
              .join('\n');
      return textOk(summary, {
        endpoints,
        total: page.total,
        limit: page.limit,
        offset: page.offset,
      });
    } catch (err) {
      return formatApiError(err);
    }
  },
});
