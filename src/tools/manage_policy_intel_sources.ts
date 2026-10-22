import { z } from 'zod';
import { defineTool, formatApiError, textError, textOk } from './shared.js';

const attachmentResultSchema = z.object({
  success: z.literal(true),
  result: z.object({
    sourcesAttached: z.number().int().nonnegative(),
    skippedAlreadyAttached: z.number().int().nonnegative(),
  }),
});

export const managePolicyIntelSourcesTool = defineTool({
  name: 'manage_policy_intel_sources',
  title: 'List, attach, or detach intel feeds on a policy',
  description:
    'Lists, attaches, or detaches global/customer-owned intel feeds on a policy current version. First use list_policies to find policy_id and list_intel_sources to discover source IDs for that platform. Customer feeds only affect endpoints in that org with the feed attached. Attach/detach changes the policy version; show the selected policy and sources to the user before making the requested change. List requires policies:read; attach/detach require policies:write.',
  inputSchema: {
    action: z.enum(['list', 'attach', 'detach']),
    policy_id: z.string().uuid(),
    source_ids: z.array(z.string().uuid()).min(1).max(60).optional().describe('1–60 enabled source IDs for attach; captures share the key creator\'s rate budget'),
    source_id: z.string().uuid().optional().describe('Source ID for detach'),
  },
  async handler({ action, policy_id, source_ids, source_id }, { client }) {
    try {
      if (action === 'list') {
        const result = await client.policyIntelSources(policy_id);
        const parsed = z.object({ sources: z.array(z.object({ id: z.string(), name: z.string() })) }).safeParse(result);
        if (!parsed.success) return textError('The API returned an invalid source list; attached sources could not be verified.');
        const sources = parsed.data.sources;
        return textOk(
          `Policy ${policy_id} has ${sources.length} intel source(s) attached.` +
          (sources.length ? `\n\n${sources.map(source => `- ${source.name} — id: ${source.id}`).join('\n')}` : ''),
          result as Record<string, unknown>,
        );
      }

      if (action === 'attach') {
        const ids = source_ids?.length ? source_ids : source_id ? [source_id] : [];
        if (ids.length === 0) return textError('source_ids or source_id is required for attach.');
        const result = await client.attachIntelSources(policy_id, ids);
        const parsed = attachmentResultSchema.safeParse(result);
        if (!parsed.success) {
          return textError('The Portal returned an invalid attachment response; the outcome could not be verified. Use action=list to inspect attached sources before retrying; a new policy version may already have been created.');
        }
        const { sourcesAttached: attached, skippedAlreadyAttached: skipped } = parsed.data.result;
        if (attached + skipped !== new Set(ids).size) {
          return {
            ...textError('The Portal attachment counts do not account for the requested sources. Use action=list to inspect attached sources before retrying; a new policy version may already have been created.'),
            structuredContent: result as Record<string, unknown>,
          };
        }
        const summary = attached === 0
          ? `No changes needed: ${skipped} intel source(s) already attached.`
          : `Attached ${attached} intel source(s) to policy ${policy_id}; ${skipped} already attached.`;
        return textOk(
          summary,
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
