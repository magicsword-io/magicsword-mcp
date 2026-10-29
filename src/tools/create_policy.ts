import { z } from 'zod';
import { MagicSwordApiError } from '../client.js';
import { defineTool, textError, textOk } from './shared.js';

const createdPolicySchema = z.object({
  policy: z.object({
    id: z.string().uuid(),
    platform: z.enum(['windows', 'macos', 'linux']),
    created_at: z.string().refine(value => Number.isFinite(Date.parse(value))),
    updated_at: z.string().refine(value => Number.isFinite(Date.parse(value))),
    current_version: z.object({
      id: z.string().uuid(),
      policy_id: z.string().uuid(),
      name: z.string(),
      version: z.literal(1),
      status: z.literal('audit'),
      policy_mode: z.enum(['blocklist', 'strict']),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

export const createPolicyTool = defineTool({
  name: 'create_policy',
  title: 'Create a MagicSword policy',
  strictInput: true,
  description:
    'Creates a new empty policy in the authenticated organization with version 1 in audit mode. ' +
    'Requires a name, platform, and policies:write. Defaults to blocklist; strict requires Enterprise and is supported only for Windows/macOS. ' +
    'Does not add rules, attach feeds, make it the default, assign devices, or enable enforcement. ' +
    'Use the returned policy ID with manage_policy_rules and manage_policy_intel_sources to build the policy. ' +
    'Each successful call creates a new policy, even with the same name. If the outcome is uncertain, list policies before retrying.',
  inputSchema: {
    name: z.string().regex(/^[^\u0000-\u001f\u007f-\u009f]*$/, 'Policy name must not contain control characters')
      .trim().min(1).max(200)
      .describe('Name for the new policy'),
    platform: z.enum(['windows', 'macos', 'linux']).describe('Operating system for this policy'),
    policy_mode: z.enum(['blocklist', 'strict']).optional()
      .describe('Defaults to blocklist. Strict requires Enterprise and is unsupported on Linux.'),
  },
  async handler({ name, platform, policy_mode }, { client }) {
    const mode = policy_mode ?? 'blocklist';
    if (platform === 'linux' && mode === 'strict') {
      return textError('Linux strict policies are not supported. Use policy_mode=blocklist.');
    }
    try {
      const result = await client.createPolicy({ name, platform, policy_mode: mode });
      const parsed = createdPolicySchema.safeParse(result);
      const policy = parsed.success ? parsed.data.policy : null;
      if (!policy || policy.platform !== platform || policy.current_version.policy_id !== policy.id ||
          policy.current_version.name !== name || policy.current_version.policy_mode !== mode) {
        return textError('The Portal returned an invalid policy-creation response; creation could not be verified. List policies before retrying: a policy may already have been created.');
      }
      return textOk(
        `Created ${platform} policy "${name}" — id: ${policy.id}. Version 1, audit mode, ${mode}. ` +
        'No devices assigned. Add rules or intelligence sources using this policy ID.',
        parsed.data,
      );
    } catch (error) {
      if (error instanceof MagicSwordApiError) {
        return textError(`Policy creation failed (${error.status}): ${error.message}. ` +
          (error.status >= 500 ? 'List policies before retrying; creation may have completed.' : ''));
      }
      return textError('Policy creation could not be verified. List policies before retrying; a policy may already have been created.');
    }
  },
});
