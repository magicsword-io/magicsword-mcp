import { z } from 'zod';
import { defineTool, formatApiError, textError, textOk } from './shared.js';

const pageSchema = z.object({
  groups: z.array(z.object({
    id: z.string().uuid(), name: z.string(), parent_group_id: z.string().uuid().nullable(),
    description: z.string().nullable(),
  }).passthrough()).max(500),
  total: z.number().int().nonnegative(), limit: z.number().int().min(1).max(500), offset: z.number().int().nonnegative(),
}).passthrough();

export const listEndpointGroupsTool = defineTool({
  name: 'list_endpoint_groups', title: 'List computer groups', strictInput: true,
  description: 'Lists paginated endpoint groups in the authenticated organization, including their parent group IDs. ' +
    'Requires endpoints:read. Use selected group IDs with apply_policy_to_endpoints to preview current members (including subgroups by default). ' +
    'Group assignment is a one-time snapshot, not an automatic rule for future members.',
  inputSchema: {
    limit: z.number().int().min(1).max(500).optional().describe('Page size, default 100'),
    offset: z.number().int().min(0).max(1_000_000).optional().describe('Pagination offset'),
  },
  async handler({ limit, offset }, { client }) {
    try {
      const parsed = pageSchema.safeParse(await client.endpointGroups({ limit, offset }));
      if (!parsed.success) return textError('The Portal returned an invalid endpoint group page.');
      const page = parsed.data;
      if (page.groups.length > page.limit || page.groups.length > Math.max(0, page.total - page.offset) || page.offset !== (offset ?? 0) ||
          page.limit !== (limit ?? 100) || new Set(page.groups.map(group => group.id)).size !== page.groups.length) {
        return textError('The Portal returned inconsistent endpoint group pagination.');
      }
      return textOk(`Showing ${page.groups.length} of ${page.total} computer groups.\n` +
        page.groups.map(group => `- ${group.name} (${group.id}) — parent: ${group.parent_group_id ?? '(none)'}`).join('\n'), page);
    } catch (error) { return formatApiError(error); }
  },
});
