import { z } from 'zod';
import { MagicSwordApiError } from '../client.js';
import { defineTool, textError, textOk } from './shared.js';

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const previewSchema = z.object({
  policy_id: uuid, current_version_id: uuid, platform: z.enum(['windows', 'macos', 'linux']),
  status: z.enum(['audit', 'enforcing', 'disabled']), policy_mode: z.enum(['blocklist', 'strict']),
  endpoint_count: z.number().int().min(1).max(500), requires_confirmation: z.literal(true),
  would_assign: z.array(z.object({
    id: uuid, computer_name: z.string().nullable(), platform: z.enum(['windows', 'macos', 'linux']),
    policy_id: uuid.nullable(), desired_policy_ids: z.array(uuid).nullable(),
  }).passthrough()).min(1).max(500),
  confirmation: z.object({ token: z.string().regex(/^msac_[A-Za-z0-9_-]{43}$/), action: z.literal('policy.assign'),
    expires_at: z.string().refine(value => Number.isFinite(Date.parse(value))) }),
}).passthrough();
const commitSchema = z.object({
  success: z.literal(true), policy_id: uuid, current_version_id: uuid,
  updated: z.number().int().min(1).max(500), endpoint_ids: z.array(uuid).min(1).max(500),
  assignment_status: z.literal('pending_checkin'),
}).passthrough();

export const applyPolicyToEndpointsTool = defineTool({
  name: 'apply_policy_to_endpoints', title: 'Preview or confirm a policy assignment', strictInput: true,
  description:
    'Requires policies:write and endpoints:read. Preview exactly one selector: endpoint_ids for one/many computers, hostname_pattern, or group_ids. ' +
    'Groups include current subgroup members by default, capped at 500 eligible computers; no future-member binding. ' +
    'Show the concrete computers, policy status/mode and replacement warning to the human. ' +
    'After approval call again with ONLY policy_id and confirmation_token from that preview. confirm=true alone cannot commit. ' +
    'The one-time server token freezes the target IDs; stale policy/assignments or ineligible computers reject the whole operation. ' +
    'This replaces desired assignments and may remove existing protections or schedule an enforcing policy. ' +
    'Success means desired state is saved, not that computers have installed it. Never automatically retry writes.',
  inputSchema: {
    policy_id: uuid.describe('Policy ID to assign'),
    endpoint_ids: z.array(uuid).min(1).max(500).refine(ids => new Set(ids).size === ids.length, 'Endpoint IDs must be unique').optional().describe('One or more endpoint IDs; exclusive with hostname_pattern/group_ids'),
    hostname_pattern: z.string().regex(/^[^\u0000-\u001f\u007f-\u009f]*$/).trim().min(1).max(255).optional()
      .describe('Case-insensitive hostname glob; exclusive with endpoint_ids/group_ids'),
    group_ids: z.array(uuid).min(1).max(50).refine(ids => new Set(ids).size === ids.length, 'Group IDs must be unique').optional().describe('Existing group IDs; exclusive with endpoint_ids/hostname_pattern'),
    include_descendants: z.boolean().optional().describe('Group selector only: include subgroups, default true'),
    platform: z.enum(['windows', 'macos', 'linux']).optional().describe('Hostname selector only: optional platform filter'),
    confirmation_token: z.string().regex(/^msac_[A-Za-z0-9_-]{43}$/).optional().describe('Server token: commit uses only policy_id and this token after approval'),
    confirm: z.boolean().optional().describe('Legacy flag: true without a server confirmation_token is rejected'),
  },
  async handler({ policy_id, endpoint_ids, hostname_pattern, group_ids, include_descendants, platform, confirmation_token, confirm }, { client }) {
    const selectors = Number(endpoint_ids !== undefined) + Number(hostname_pattern !== undefined) + Number(group_ids !== undefined);
    if (confirmation_token) {
      if (selectors || include_descendants !== undefined || platform !== undefined || confirm !== undefined) {
        return textError('Commit must contain only policy_id and confirmation_token. The approved preview already fixes the computers.');
      }
      try {
        const parsed = commitSchema.safeParse(await client.assignPolicyWithConfirmation(policy_id, confirmation_token));
        if (!parsed.success || parsed.data.policy_id !== policy_id ||
            parsed.data.updated !== parsed.data.endpoint_ids.length || new Set(parsed.data.endpoint_ids).size !== parsed.data.updated) {
          return textError('Assignment result could not be verified. Check endpoint desired assignments before retrying; the operation may have committed.');
        }
        return textOk(`Saved policy ${policy_id} as the desired assignment for ${parsed.data.updated} computer(s). ` +
          'Replaced their previous desired policy assignments. Waiting for agent check-in; installation and enforcement have not been verified.', parsed.data);
      } catch (error) {
        const status = error instanceof MagicSwordApiError ? ` (HTTP ${error.status})` : '';
        return textError(`Policy assignment failed${status}. Check endpoint desired assignments before retrying. ` +
          'A fresh preview may be needed; a failed response does not prove no changes occurred.');
      }
    }
    if (confirm === true) return textError('confirm=true alone cannot assign. Preview first, show it to the human, then pass its confirmation_token.');
    if (selectors !== 1 || (include_descendants !== undefined && !group_ids) || (platform !== undefined && !hostname_pattern)) {
      return textError('Preview requires exactly one of endpoint_ids, hostname_pattern or group_ids. include_descendants is group-only; platform is hostname-only.');
    }
    try {
      const parsed = previewSchema.safeParse(await client.previewPolicyAssignment(policy_id, {
        ...(endpoint_ids ? { endpoint_ids } : {}), ...(hostname_pattern ? { hostname_pattern } : {}),
        ...(group_ids ? { group_ids, include_descendants: include_descendants ?? true } : {}),
        ...(platform ? { platform } : {}),
      }));
      if (!parsed.success) return textError('The Portal returned an invalid assignment preview. No commit was requested.');
      const body = parsed.data, targets = body.would_assign, ids = new Set(targets.map(target => target.id));
      if (body.policy_id !== policy_id || body.endpoint_count !== targets.length || ids.size !== targets.length ||
          targets.some(target => target.platform !== body.platform) || (platform && platform !== body.platform) ||
          Date.parse(body.confirmation.expires_at) <= Date.now() ||
          (endpoint_ids && (new Set(endpoint_ids).size !== ids.size || endpoint_ids.some(id => !ids.has(id))))) {
        return textError('Assignment preview does not match the requested policy or computers. No commit was requested.');
      }
      return textOk(`PREVIEW — policy ${policy_id}, ${body.platform}, ${body.status}, ${body.policy_mode}.\n` +
        targets.map(target => `- ${target.computer_name ?? '(unnamed)'} (${target.id}) — previous desired: ${(target.desired_policy_ids ?? []).join(', ') || target.policy_id || '(none)'}`).join('\n') +
        '\nThis REPLACES existing desired assignments. An audit policy can remove existing blocking protection; an enforcing policy may block applications. ' +
        'No endpoint assignments changed. Group membership is a snapshot; later changes do not add targets or create a persistent binding. ' +
        `After human approval, call again with only policy_id and confirmation_token. Expires ${body.confirmation.expires_at}.`, body);
    } catch (error) {
      const status = error instanceof MagicSwordApiError ? ` (HTTP ${error.status})` : '';
      return textError(`Policy assignment preview failed${status}. Requires policies:write and endpoints:read, with compatible agent-managed computers. No commit was requested.`);
    }
  },
});
