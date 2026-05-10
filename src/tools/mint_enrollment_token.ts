import { z } from 'zod';
import { defineTool, formatApiError, textOk } from './shared.js';

export const mintEnrollmentTokenTool = defineTool({
  name: 'mint_enrollment_token',
  title: 'Mint a MagicSword agent enrollment token',
  description:
    'Mints a one-time enrollment token used to register a new MagicSword agent against the org owning the API key. ' +
    'The returned token is bearer-equivalent for enrollment — surface it to the human and instruct them to use it ' +
    'within the TTL. Default TTL is 1 hour; min 5 minutes; max 24 hours.',
  inputSchema: {
    ttl_seconds: z.number().int().min(300).max(86400).optional()
      .describe('Time-to-live in seconds (300–86400, default 3600)'),
  },
  async handler({ ttl_seconds }, { client }) {
    try {
      const minted = await client.mintEnrollmentToken({ ttl_seconds });
      const text = [
        `Enrollment token minted for org ${minted.org_id}.`,
        `Expires at: ${minted.expires_at} (TTL ${minted.ttl_seconds}s)`,
        '',
        'Token (single-use, treat as a secret):',
        minted.token,
        '',
        'Use the token with the agent installer\'s --enroll flag, or open the magicsword-deployer:// deep link from the portal.',
      ].join('\n');
      return textOk(text, minted as unknown as Record<string, unknown>);
    } catch (err) {
      return formatApiError(err);
    }
  },
});
