import { z } from 'zod';
import { MagicSwordApiError } from '../client.js';
import { defineTool, formatApiError, textError, textOk } from './shared.js';

function renderPreview(policyId: string, preview: Record<string, unknown>): ReturnType<typeof textOk> {
  const confirmation = preview.confirmation as { token?: string; expires_at?: string } | undefined;
  const blockers = Array.isArray(preview.blockers) ? (preview.blockers as string[]) : [];
  const readiness = preview.readiness as Record<string, unknown> | undefined;
  const preflight = preview.preflight as Record<string, unknown> | undefined;

  const lines = [
    `PREVIEW — policy ${policyId} enforcement flip`,
    `Can enforce: ${preview.can_enforce === true ? 'yes' : 'requires acknowledgement'}`,
    `Endpoints affected: ${preflight?.endpoint_count ?? preview.endpoint_count ?? '?'}`,
  ];
  if (readiness) {
    lines.push(
      `Readiness: score=${readiness.readinessScore ?? '?'} pending=${readiness.pending ?? '?'} escalated=${readiness.escalated ?? '?'}`,
    );
  }
  if (blockers.length > 0) {
    lines.push('', 'Blockers:');
    for (const blocker of blockers) lines.push(`  - ${blocker}`);
    lines.push(
      '',
      'If the human accepts these blockers, re-run preview with acknowledge_blockers=true to mint an acknowledged token.',
    );
  } else {
    lines.push('', 'No blockers reported.');
  }
  lines.push('');
  lines.push('This is destructive and can cause endpoint blocking.');

  if (confirmation?.token) {
    lines.push(`To commit, call flip_to_enforcing again with confirmation_token="${confirmation.token}".`);
    lines.push(`Token expires at ${confirmation.expires_at ?? '(unknown)'}.`);
  } else {
    lines.push('No confirmation token was minted yet.');
  }

  return textOk(lines.join('\n'), preview);
}

export const flipToEnforcingTool = defineTool({
  name: 'flip_to_enforcing',
  title: 'Flip a policy from audit to enforcing',
  description:
    'Promotes a MagicSword policy from audit to enforcing mode through the Portal server confirmation flow. ' +
    'First call without confirmation_token to get readiness, blockers, endpoint count, and a one-time token. ' +
    'Show the preview to the human. Second call with confirmation_token to commit. Requires policies:write.',
  inputSchema: {
    policy_id: z.string().uuid().describe('Policy UUID to flip'),
    acknowledge_blockers: z
      .boolean()
      .optional()
      .describe('Set true only when the human explicitly accepts preview blockers. Used on the preview call.'),
    confirmation_token: z
      .string()
      .min(1)
      .max(4096)
      .optional()
      .describe('Token returned by the preview call. Passing this commits enforcement.'),
  },
  async handler({ policy_id, acknowledge_blockers, confirmation_token }, { client }) {
    try {
      if (confirmation_token) {
        const result = await client.enforcePolicy(policy_id, confirmation_token);
        return textOk(`Policy ${policy_id} was flipped to enforcing.`, result as Record<string, unknown>);
      }

      const structured = (await client.enforcePreview(policy_id, acknowledge_blockers === true)) as Record<
        string,
        unknown
      >;
      const confirmation = structured.confirmation as { token?: string; expires_at?: string } | undefined;

      if (!confirmation?.token) {
        return textError('Portal did not return a confirmation token. Re-run preview or inspect the API response.');
      }

      return renderPreview(policy_id, structured);
    } catch (err) {
      if (err instanceof MagicSwordApiError && err.status === 409 && err.body && typeof err.body === 'object') {
        const body = err.body as Record<string, unknown>;
        if (typeof body.error === 'string' && body.error.toLowerCase().includes('already enforcing')) {
          return textOk(`Policy ${policy_id} is already enforcing; no enforcement flip is needed.`, body);
        }
        if (Array.isArray(body.blockers) || body.readiness) {
          return renderPreview(policy_id, {
            ...body,
            can_enforce: false,
          });
        }
      }
      return formatApiError(err);
    }
  },
});
