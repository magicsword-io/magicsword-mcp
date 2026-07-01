import { z } from 'zod';
import { defineTool, formatApiError, textOk } from './shared.js';

export const showPolicyTool = defineTool({
  name: 'show_policy',
  title: 'Show a single MagicSword policy',
  description:
    'Returns the active version + status for one policy by id.',
  inputSchema: {
    policy_id: z.string().min(1).describe('The policy UUID'),
  },
  async handler({ policy_id }, { client }) {
    try {
      const { policy } = await client.policy(policy_id);
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
        lines.push(`  Status: ${v.status ?? 'unknown'} (audit/enforcing/disabled)`);
        lines.push(`  Policy mode: ${v.policy_mode} (blocklist/strict)`);
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
