import { z } from 'zod';
import { defineTool, formatApiError, textError, textOk } from './shared.js';

export const managePolicyIntelSourcesTool = defineTool({
  name: 'manage_policy_intel_sources',
  title: 'List, attach, or detach intel feeds on a policy',
  description:
    'Lists, attaches, or detaches global/customer-owned intel feeds on a policy current version. Customer feeds only affect endpoints in that org with the feed attached. List requires policies:read; attach/detach require policies:write.',
  inputSchema: {
    action: z.enum(['list', 'attach', 'detach']),
    policy_id: z.string().uuid(),
    source_ids: z.array(z.string().uuid()).min(1).max(100).optional().describe('One or more source IDs for attach'),
    source_id: z.string().uuid().optional().describe('Source ID for detach'),
  },
  async handler({ action, policy_id, source_ids, source_id }, { client }) {
    try {
      if (action === 'list') {
        const result = await client.policyIntelSources(policy_id);
        const sources = Array.isArray((result as any).sources) ? (result as any).sources : [];
        return textOk(
          `Policy ${policy_id} has ${sources.length} intel source(s) attached.`,
          result as Record<string, unknown>,
        );
      }

      if (action === 'attach') {
        const ids = source_ids?.length ? source_ids : source_id ? [source_id] : [];
        if (ids.length === 0) return textError('source_ids or source_id is required for attach.');
        const result = await client.attachIntelSources(policy_id, ids);
        return textOk(
          `Attached ${ids.length} intel source(s) to policy ${policy_id}.`,
          result as Record<string, unknown>,
        );
      }

      if (!source_id) return textError('source_id is required for detach.');
      const result = await client.detachIntelSource(policy_id, source_id);
      return textOk(`Detached intel source ${source_id} from policy ${policy_id}.`, result as Record<string, unknown>);
    } catch (err) {
      return formatApiError(err);
    }
  },
});
