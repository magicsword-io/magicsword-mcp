import { z } from 'zod';
import { MagicSwordApiError } from '../client.js';
import { defineTool, formatApiError, textError, textOk } from './shared.js';

export const listAuditLogsTool = defineTool({
  name: 'list_audit_logs',
  title: 'List organization audit logs',
  description:
    'Read verified administrative activity for the API key’s organization, including policy changes and endpoint retirements. ' +
    'Requires Enterprise and audit:read. Filter by action, actor, or time and paginate newest first.',
  strictInput: true,
  inputSchema: {
    since: z.string().min(1).max(100).optional().describe('Inclusive ISO 8601 lower bound. Defaults to a 30-day lookback.'),
    before: z.string().min(1).max(100).optional().describe('Exclusive ISO 8601 upper bound.'),
    action: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/).optional().describe('Exact action name, such as policy_created.'),
    actor_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).optional().describe('Exact actor user UUID.'),
    limit: z.number().int().min(1).max(200).optional().describe('Page size, default 50.'),
    offset: z.number().int().min(0).max(1_000_000).optional().describe('Number of matching records to skip.'),
  },
  async handler(args, { client }) {
    try {
      const result = await client.auditLogs(args);
      if (!Array.isArray(result?.audit_logs)) {
        return textError('MagicSword returned an invalid audit log response.');
      }
      return textOk(JSON.stringify(result), { ...result });
    } catch (error) {
      if (error instanceof MagicSwordApiError && error.status === 403 && error.feature === 'auditReporting') {
        return textError('Organization audit logs require the Enterprise plan.');
      }
      return formatApiError(error);
    }
  },
});
