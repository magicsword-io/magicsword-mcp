import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { defineTool, formatApiError, textError, textOk } from './shared.js';

interface PendingNonce {
  policy_id: string;
  expires_at: number; // epoch ms
  endpoint_ids: string[];
}

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const pending = new Map<string, PendingNonce>();

function pruneExpired(): void {
  const now = Date.now();
  for (const [token, p] of pending.entries()) {
    if (p.expires_at <= now) pending.delete(token);
  }
}

function newNonce(): string {
  return `flip_${randomBytes(12).toString('hex')}`;
}

export const flipToEnforcingTool = defineTool({
  name: 'flip_to_enforcing',
  title: 'Flip a policy from audit to enforcing (with mandatory preview + confirm)',
  description:
    'Promotes a MagicSword policy from audit to enforcing mode. SAFETY-CRITICAL: this is destructive — it can ' +
    'block legitimate processes on every endpoint that policy is assigned to. ' +
    '\n\nFlow: ' +
    '\n1) Call WITHOUT confirm_token. The tool returns a preview of affected endpoints + a server-issued ' +
    'one-time confirm_token (valid 5 minutes, single-use). Show this to the human and get explicit consent. ' +
    '\n2) Call AGAIN with the same policy_id and the confirm_token. The tool will perform the flip. ' +
    '\n\nThe write endpoint is not yet in the public API; the actual flip currently surfaces a "coming soon" ' +
    'notice. The preview/confirm protocol is enforced today so behavior is correct the moment the write ' +
    'endpoint ships.',
  inputSchema: {
    policy_id: z.string().min(1).describe('Policy UUID to flip'),
    confirm_token: z.string().optional()
      .describe('Omit on first call to receive a preview + nonce. Pass the returned token on the second call to commit.'),
  },
  async handler({ policy_id, confirm_token }, { client }) {
    pruneExpired();
    try {
      // Stage 2: confirmation.
      if (confirm_token) {
        const entry = pending.get(confirm_token);
        if (!entry) {
          return textError(
            'confirm_token is unknown or expired. Re-run flip_to_enforcing without a token to get a fresh preview.',
          );
        }
        if (entry.policy_id !== policy_id) {
          return textError(
            `confirm_token was issued for policy ${entry.policy_id}, not ${policy_id}. Re-run without a token.`,
          );
        }
        if (entry.expires_at <= Date.now()) {
          pending.delete(confirm_token);
          return textError('confirm_token has expired. Re-run flip_to_enforcing without a token.');
        }
        // One-shot: consume immediately whether or not the call succeeds.
        pending.delete(confirm_token);

        return textOk(
          `[coming soon] confirm_token accepted for policy ${policy_id}. ` +
            `The MagicSword public API does not yet expose policy enforcement-flip — this would have committed ` +
            `enforcement on ${entry.endpoint_ids.length} endpoint(s). When the write endpoint ships this tool ` +
            `will POST the flip here. No production state was changed.`,
          { committed: false, policy_id, would_affect: entry.endpoint_ids },
        );
      }

      // Stage 1: preview.
      const policiesResp = await client.policies();
      const policy = policiesResp.policies.find((p) => p.id === policy_id);
      if (!policy) {
        return textError(`Policy ${policy_id} not found in this org. Run list_policies first.`);
      }
      const currentMode = policy.current_version?.policy_mode ?? '(none)';
      if (currentMode === 'enforcing') {
        return textOk(
          `Policy ${policy_id} is already in enforcing mode (current version: ${policy.current_version?.version}). No flip needed.`,
          { already_enforcing: true, policy_id },
        );
      }

      // Resolve affected endpoints (those assigned to this policy).
      const endpointsResp = await client.endpoints({ platform: policy.platform, limit: 500 });
      const affected = endpointsResp.endpoints.filter((e) => e.policy_id === policy_id);

      const nonce = newNonce();
      pending.set(nonce, {
        policy_id,
        endpoint_ids: affected.map((e) => e.id),
        expires_at: Date.now() + NONCE_TTL_MS,
      });

      const lines: string[] = [];
      lines.push(`PREVIEW — flipping policy ${policy_id} to enforcing.`);
      lines.push(`Platform: ${policy.platform}`);
      lines.push(`Current mode: ${currentMode}`);
      lines.push(`Endpoints assigned to this policy: ${affected.length}`);
      if (affected.length > 0) {
        const sample = affected.slice(0, 25).map((e) =>
          `  - ${e.computer_name ?? '(no name)'}  ${e.id}  status=${e.status ?? '?'}`,
        );
        lines.push(...sample);
        if (affected.length > 25) lines.push(`  ... and ${affected.length - 25} more`);
      }
      lines.push('');
      lines.push('SAFETY: This is destructive. It will start blocking processes on every listed endpoint.');
      lines.push(`If the human confirms, call flip_to_enforcing again with confirm_token="${nonce}".`);
      lines.push(`The token is single-use and expires in ${Math.round(NONCE_TTL_MS / 60000)} minutes.`);

      return textOk(lines.join('\n'), {
        preview: true,
        confirm_token: nonce,
        expires_at: new Date(Date.now() + NONCE_TTL_MS).toISOString(),
        policy_id,
        affected_endpoint_ids: affected.map((e) => e.id),
      });
    } catch (err) {
      return formatApiError(err);
    }
  },
});
