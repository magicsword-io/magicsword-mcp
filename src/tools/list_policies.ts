import { z } from 'zod';
import { defineTool, formatApiError, textOk } from './shared.js';

export const listPoliciesTool = defineTool({
  name: 'list_policies',
  title: 'List MagicSword policies',
  description:
    'Lists policies in the MagicSword org, including each policy\'s current published version (name, version, status, policy mode). ' +
    'Filter by platform if you only care about windows / macos / linux. The current_version block tells you ' +
    'status (audit/enforcing/disabled) separately from policy_mode (blocklist/strict).',
  inputSchema: {
    platform: z.enum(['windows', 'macos', 'linux']).optional()
      .describe('Restrict to one platform'),
  },
  async handler({ platform }, { client }) {
    try {
      const result = await client.policies({ platform });
      if (result.policies.length === 0) {
        return textOk(`No policies in this org${platform ? ` for platform ${platform}` : ''}.`, { policies: [] });
      }
      const lines = result.policies.map((p) => {
        const v = p.current_version;
        const head = `- [${p.platform}] ${v?.name ?? '(unnamed)'} — id: ${p.id}`;
        const versionLine = v
          ? `    version: ${v.version}  status: ${v.status ?? 'unknown'}  policy_mode: ${v.policy_mode}  updated: ${v.updated_at}`
          : `    (no published version)`;
        return [head, versionLine].join('\n');
      });
      return textOk(`Found ${result.policies.length} policies.\n\n${lines.join('\n')}`, {
        policies: result.policies,
      });
    } catch (err) {
      return formatApiError(err);
    }
  },
});
