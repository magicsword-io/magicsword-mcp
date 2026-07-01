import { z } from 'zod';
import { defineTool, formatApiError, textOk } from './shared.js';

export const listEventsTool = defineTool({
  name: 'list_events',
  title: 'List MagicSword audit/block events',
  description:
    'Lists org telemetry events as JSON. Use this for requests like “show me the last day of audit events” or “find blocked events for this policy”. Requires alerts:read.',
  inputSchema: {
    hours: z.number().positive().max(24 * 31).optional().describe('Lookback window in hours; defaults to 24'),
    since: z.string().optional().describe('ISO timestamp lower bound; overrides hours when provided'),
    status: z.string().optional().describe('Comma-separated statuses, e.g. audited,blocked'),
    type: z.string().optional().describe('Comma-separated event types, e.g. process,filepath,hash'),
    platform: z.enum(['windows', 'macos', 'linux']).optional(),
    endpoint_id: z.string().optional(),
    policy_id: z.string().optional(),
    q: z.string().optional().describe('Search name, file, hash, path, or computer'),
    limit: z.number().int().positive().max(500).optional(),
    offset: z.number().int().min(0).optional(),
  },
  async handler(args, { client }) {
    try {
      const result = await client.events(args);
      const lines = result.events.slice(0, 50).map((event) =>
        `- ${event.created_at ?? event.last_seen_at ?? ''} [${event.platform ?? '?'}] ${event.status}/${event.type} ` +
        `${event.name ?? event.file_name ?? event.file_path ?? event.file_hash ?? event.id} id=${event.id}`,
      );
      return textOk(
        `Found ${result.total} event(s) since ${result.since}. Showing ${result.events.length}.\n\n${lines.join('\n')}`,
        result as unknown as Record<string, unknown>,
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
});
