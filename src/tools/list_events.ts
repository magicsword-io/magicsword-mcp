import { z } from 'zod';
import { defineTool, formatApiError, textOk } from './shared.js';

export const listEventsTool = defineTool({
  name: 'list_events',
  title: 'Investigate MagicSword audit/block events',
  description:
    'Searches normalized Investigate events across name, filename, path, hash, publisher, computer, and package family, with optional type, status, policy, and endpoint filters. ' +
    'For “show filename audit events for image.png”, use type=filename, status=audited, file_name=image.png. ' +
    'Defaults to audited and blocked events over the last 24 hours, based on when they were last observed. ' +
    'Returns file paths, publishers, hashes, endpoint names, occurrence counts, timestamps, and rule context without raw telemetry. ' +
    'Search is read-only. To create rules, review the results and pass selected event IDs to manage_policy_rules with an explicit status and optional rule type. Requires alerts:read.',
  inputSchema: {
    hours: z
      .number()
      .positive()
      .max(24 * 31)
      .optional()
      .describe('Lookback window in hours; defaults to 24'),
    since: z.string().max(64).optional().describe('ISO timestamp lower bound; overrides hours when provided'),
    status: z.string().max(255).optional().describe('Comma-separated statuses, e.g. audited,blocked'),
    type: z.string().max(255).optional().describe('Comma-separated event types, e.g. process,filepath,hash'),
    platform: z.enum(['windows', 'macos', 'linux']).optional(),
    endpoint_id: z.string().uuid().optional(),
    policy_id: z.string().uuid().optional(),
    file_name: z.string().min(1).max(255).optional().describe('Exact, case-sensitive filename, e.g. image.png; punctuation is literal'),
    q: z.string().max(120).regex(/^[^\u0000-\u001f\u007f-\u009f]*$/, 'Search must not contain control characters').optional()
      .describe('Case-insensitive literal substring search across name, filename, path, hash, publisher, computer, and package family. Up to 120 characters, including Unicode and punctuation; %, _, and * are literal. Omit type to search across event types. Combine with file_name for an exact filename.'),
    limit: z.number().int().positive().max(500).optional(),
    offset: z.number().int().min(0).max(1_000_000).optional(),
  },
  async handler(args, { client }) {
    try {
      const result = await client.events(args);
      const lines = result.events
        .map((event) => {
          const ruleContext = event.rule_context
            ? ` rule_context=${JSON.stringify(event.rule_context)}`
            : '';
          return (
            `- ${event.last_seen_at ?? event.created_at ?? ''} [${event.platform ?? '?'}] ${event.status}/${event.type} ` +
            `${event.file_name ?? event.name ?? event.id} id=${event.id} computer=${event.computer_name ?? '?'} ` +
            `path=${event.file_path ?? '?'} hash=${event.file_hash ?? '?'} publisher=${event.publisher ?? '?'} ` +
            `package_family=${event.package_family_name ?? '?'} ` +
            `occurrences=${event.occurrence_count ?? '?'}${ruleContext}`
          );
        });
      return textOk(
        `Found ${result.total} event(s) observed since ${result.since}. Showing ${result.events.length} at offset ${result.offset}.\n\n${lines.join('\n')}`,
        result as unknown as Record<string, unknown>,
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
});
