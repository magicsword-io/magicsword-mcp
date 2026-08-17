import { z } from 'zod';
import { defineTool, formatApiError, textOk } from './shared.js';

export const listAgentReleasesTool = defineTool({
  name: 'list_agent_releases',
  title: 'List MagicSword agent releases',
  description:
    'Lists available MagicSword agent releases and per-platform latest markers before an upgrade is queued. ' +
    'Requires endpoints:read.',
  inputSchema: {
    platform: z.enum(['windows', 'macos', 'linux']).optional().describe('Platform used for latest filtering'),
    latest: z.boolean().optional().describe('Return only the latest release for the selected platform'),
  },
  async handler({ platform, latest }, { client }) {
    try {
      const result = await client.agentReleases({ platform, latest });
      const lines = result.releases.map((release) => {
        const latestFor = [
          release.is_latest_windows ? 'windows' : null,
          release.is_latest_macos ? 'macos' : null,
          release.is_latest_linux ? 'linux' : null,
        ].filter(Boolean);
        return [
          `- ${release.version} (${release.id})`,
          `    created: ${release.created_at}; latest: ${release.is_latest ? 'all' : latestFor.join(', ') || 'no'}`,
          release.min_upgrade_version ? `    minimum upgrade source: ${release.min_upgrade_version}` : null,
          release.release_notes ? `    notes: ${release.release_notes}` : null,
        ]
          .filter(Boolean)
          .join('\n');
      });
      return textOk(
        result.releases.length === 0 ? 'No agent releases matched.' : `Agent releases:\n${lines.join('\n')}`,
        result as unknown as Record<string, unknown>,
      );
    } catch (error) {
      return formatApiError(error);
    }
  },
});
