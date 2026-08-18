import { z } from 'zod';
import { defineTool, textOk } from './shared.js';

const SNIPPETS: Record<'macos' | 'linux' | 'windows', { headline: string; body: string }> = {
  macos: {
    headline: 'Install the MagicSword agent on macOS:',
    body: [
      'Recommended: open Magic Portal and use Add endpoint to generate the current enrollment command.',
      '',
      'Then enroll using a token from `mint_enrollment_token`:',
      'curl -fsSL https://www.magicsword.io/install.sh | sudo MAGICSWORD_TOKEN=<ENROLL_TOKEN> MAGICSWORD_PORTAL_URL=https://www.magicsword.io bash',
    ].join('\n'),
  },
  linux: {
    headline: 'Install the MagicSword agent on Linux:',
    body: [
      'Recommended: open Magic Portal and use Add endpoint to generate the current enrollment command.',
      '',
      'Then enroll using a token from `mint_enrollment_token`:',
      'curl -fsSL https://www.magicsword.io/install.sh | sudo MAGICSWORD_TOKEN=<ENROLL_TOKEN> MAGICSWORD_PORTAL_URL=https://www.magicsword.io bash',
    ].join('\n'),
  },
  windows: {
    headline: 'Install the MagicSword agent on Windows:',
    body: [
      'Recommended: open the portal and click "Add endpoint" to launch the magicsword-deployer:// deep link.',
      'It opens the registration UI with the org pre-filled and exchanges a one-time enrollment token automatically.',
      '',
      'PowerShell enrollment using a token from `mint_enrollment_token`:',
      '$env:MAGICSWORD_TOKEN="<ENROLL_TOKEN>"; $env:MAGICSWORD_PORTAL_URL="https://www.magicsword.io"; irm https://www.magicsword.io/install.ps1 | iex',
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
