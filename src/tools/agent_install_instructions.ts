import { z } from 'zod';
import { defineTool, textOk } from './shared.js';

const SNIPPETS: Record<'macos' | 'linux' | 'windows', { headline: string; body: string }> = {
  macos: {
    headline: 'Install the MagicSword agent on macOS (Homebrew tap):',
    body: [
      'brew tap magicsword-io/magicsword',
      'brew install magicsword-agent',
      '',
      'Then enroll using a token from `mint_enrollment_token`:',
      'sudo magicsword-agent enroll --token <ENROLL_TOKEN>',
    ].join('\n'),
  },
  linux: {
    headline: 'Install the MagicSword agent on Linux (curl-pipe):',
    body: [
      'curl -fsSL https://get.magicsword.io/agent.sh | sudo sh',
      '',
      'Then enroll using a token from `mint_enrollment_token`:',
      'sudo magicsword-agent enroll --token <ENROLL_TOKEN>',
    ].join('\n'),
  },
  windows: {
    headline: 'Install the MagicSword agent on Windows:',
    body: [
      'Recommended: open the portal and click "Add endpoint" to launch the magicsword-deployer:// deep link.',
      'It opens the registration UI with the org pre-filled and exchanges a one-time enrollment token automatically.',
      '',
      'Manual install (winget):',
      'winget install MagicSword.Deployer',
      '',
      'Then either click the deep link from the portal or paste the enrollment token in the tray app\'s Register dialog.',
    ].join('\n'),
  },
};

export const agentInstallInstructionsTool = defineTool({
  name: 'agent_install_instructions',
  title: 'Show the MagicSword agent install one-liner for a platform',
  description:
    'Returns the install + enroll commands for the MagicSword agent on a given platform. No API call. ' +
    'Useful when the LLM is helping a user onboard a new endpoint and wants to hand them the exact one-liner.',
  inputSchema: {
    platform: z.enum(['macos', 'linux', 'windows'])
      .describe('Target platform for install instructions'),
  },
  async handler({ platform }) {
    const snippet = SNIPPETS[platform];
    return textOk(`${snippet.headline}\n\n${snippet.body}`, { platform, ...snippet });
  },
});
