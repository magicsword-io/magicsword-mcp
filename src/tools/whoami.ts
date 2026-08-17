import { defineTool, formatApiError, textOk } from './shared.js';

export const whoamiTool = defineTool({
  name: 'whoami',
  title: 'Identify the MagicSword org and key',
  description:
    'Returns the MagicSword organization, API key id, and granted scopes for the configured key. ' +
    'Call this first when troubleshooting access — it answers "who am I and what can this key do?". ' +
    'Useful before any other tool to confirm the key is still valid.',
  inputSchema: {},
  async handler(_args, { client }) {
    try {
      const me = await client.me();
      const lines = [
        `Org: ${me.org.name ?? '(unnamed)'} (${me.org.id})`,
        me.org.organization_type ? `Org type: ${me.org.organization_type}` : null,
        `Key ID: ${me.key_id}`,
        `Scopes: ${me.scopes.length ? me.scopes.join(', ') : '(none)'}`,
      ].filter(Boolean) as string[];
      return textOk(lines.join('\n'), me as unknown as Record<string, unknown>);
    } catch (err) {
      return formatApiError(err);
    }
  },
});
