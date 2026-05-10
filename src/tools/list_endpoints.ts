import { z } from 'zod';
import { defineTool, formatApiError, globToRegex, textOk } from './shared.js';
import type { Endpoint } from '../types.js';

export const listEndpointsTool = defineTool({
  name: 'list_endpoints',
  title: 'List MagicSword endpoints',
  description:
    'Lists endpoints (devices) enrolled in the MagicSword org. ' +
    'Filter by platform (windows/macos/linux), status, or hostname pattern (glob: "*", "?"). ' +
    'Hostname filtering is performed client-side after fetching the page from the API. ' +
    'Returns up to `limit` endpoints (default 100, max 500). Use this to find endpoint IDs for other tools.',
  inputSchema: {
    platform: z.enum(['windows', 'macos', 'linux']).optional()
      .describe('Filter by OS platform'),
    status: z.string().optional()
      .describe('Filter by endpoint status (e.g. "online", "offline", "uninstalled")'),
    hostname_pattern: z.string().optional()
      .describe('Glob pattern matched case-insensitively against computer_name (e.g. "prod-*", "win-?-db")'),
    limit: z.number().int().min(1).max(500).optional()
      .describe('Page size (default 100, max 500). Hostname-filtering is applied AFTER paging.'),
    offset: z.number().int().min(0).optional()
      .describe('Skip this many records before returning (for paging)'),
  },
  async handler({ platform, status, hostname_pattern, limit, offset }, { client }) {
    try {
      const page = await client.endpoints({ platform, status, limit, offset });
      let endpoints: Endpoint[] = page.endpoints;
      let filteredNote = '';
      if (hostname_pattern) {
        const re = globToRegex(hostname_pattern);
        const before = endpoints.length;
        endpoints = endpoints.filter((e) => e.computer_name && re.test(e.computer_name));
        filteredNote = ` (client-side hostname_pattern filter kept ${endpoints.length}/${before})`;
      }
      const summary =
        endpoints.length === 0
          ? `No endpoints matched on this page (server returned ${page.total} total endpoints in the org${filteredNote}).`
          : `Showing ${endpoints.length} of ${page.total} total${filteredNote}.\n\n` +
            endpoints
              .map((e) => {
                const lastSeen = e.last_checkin ?? e.last_heartbeat ?? 'never';
                return [
                  `- ${e.computer_name ?? '(unnamed)'} [${e.platform}]`,
                  `    id: ${e.id}`,
                  `    status: ${e.status ?? '(unknown)'} / compliance: ${e.compliance_status ?? '(unknown)'}`,
                  `    policy_id: ${e.policy_id ?? '(none)'}  installer: ${e.installer_version ?? '(unknown)'}`,
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
