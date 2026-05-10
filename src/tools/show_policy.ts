import { z } from 'zod';
import { defineTool, formatApiError, textError, textOk } from './shared.js';

export const showPolicyTool = defineTool({
  name: 'show_policy',
  title: 'Show a single MagicSword policy',
  description:
    'Returns the active version + status for one policy by id. ' +
    'Currently implemented by filtering the list_policies output, since the public API does not yet expose a /policies/:id detail route.',
  inputSchema: {
    policy_id: z.string().min(1).describe('The policy UUID'),
  },
  async handler({ policy_id }, { client }) {
    try {
      const result = await client.policies();
      const policy = result.policies.find((p) => p.id === policy_id);
      if (!policy) {
        return textError(`Policy ${policy_id} not found in this org.`);
      }
      const v = policy.current_version;
      const lines = [
        `Policy ${policy.id}`,
        `Platform: ${policy.platform}`,
        `Created: ${policy.created_at}`,
        `Updated: ${policy.updated_at}`,
      ];
      if (v) {
        lines.push('', 'Current version:');
        lines.push(`  Name: ${v.name ?? '(unnamed)'}`);
        lines.push(`  Version: ${v.version}`);
        lines.push(`  Mode: ${v.policy_mode}`);
        lines.push(`  Updated: ${v.updated_at}`);
        if (v.change_message) lines.push(`  Change message: ${v.change_message}`);
      } else {
        lines.push('', 'No published version.');
      }
      return textOk(lines.join('\n'), policy as unknown as Record<string, unknown>);
    } catch (err) {
      return formatApiError(err);
    }
  },
});
