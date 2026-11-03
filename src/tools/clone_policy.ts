import { z } from 'zod';
import { MagicSwordApiError } from '../client.js';
import { defineTool, textError, textOk } from './shared.js';

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const responseSchema = z.object({
  policy: z.object({
    id: uuid, platform: z.enum(['windows', 'macos', 'linux']),
    created_at: z.string().refine(value => Number.isFinite(Date.parse(value))),
    updated_at: z.string().refine(value => Number.isFinite(Date.parse(value))),
    current_version: z.object({
      id: uuid, policy_id: uuid, name: z.string(),
      version: z.literal(1), status: z.literal('audit'), parent_version_id: z.null(), policy_mode: z.enum(['blocklist', 'strict']),
    }).passthrough(),
  }).passthrough(),
  cloned_from: z.object({ policy_id: uuid, version_id: uuid }),
  copied: z.object({ rules: z.number().int().nonnegative(), intelligence_sources: z.number().int().nonnegative(),
    analytics_collections: z.number().int().nonnegative() }),
}).passthrough();

const reconcile = 'List policies before retrying; a clone may already have been created.';
export const clonePolicyTool = defineTool({
  name: 'clone_policy', title: 'Clone a MagicSword policy', strictInput: true,
  description:
    'Copies the current version of a policy into a new, independent policy with the requested name. ' +
    'Preserves supported rules, settings, intelligence source links and collection links; starts at version 1 in audit mode. ' +
    'Does not assign devices, change the source, make a default, or enable enforcement. Requires policies:write and access to all copied content. ' +
    'Use apply_policy_to_endpoints with the returned policy ID to preview a later assignment. Never automatically retry cloning: list policies if the outcome is uncertain.',
  inputSchema: {
    policy_id: uuid.describe('Source policy ID from list_policies'),
    name: z.string().regex(/^[^\u0000-\u001f\u007f-\u009f]*$/, 'Policy name must not contain control characters')
      .trim().min(1).max(200).describe('Name for the new audit copy'),
  },
  async handler({ policy_id, name }, { client }) {
    try {
      const parsed = responseSchema.safeParse(await client.clonePolicy(policy_id, { name }));
      if (!parsed.success) return textError(`Invalid policy clone response. ${reconcile}`);
      const body = parsed.data, policy = body.policy, version = policy.current_version;
      if (policy.id === policy_id || body.cloned_from.policy_id !== policy_id ||
          version.policy_id !== policy.id || version.id === body.cloned_from.version_id || version.name !== name ||
          (policy.platform === 'linux' && version.policy_mode !== 'blocklist')) {
        return textError(`Policy clone identity or version could not be verified. ${reconcile}`);
      }
      return textOk(`Cloned policy as "${name}" — id: ${policy.id}. Version 1, audit mode, ${policy.platform}. ` +
        `Copied ${body.copied.rules} rules, ${body.copied.intelligence_sources} intelligence links and ${body.copied.analytics_collections} collection links. ` +
        'No computers assigned. Use apply_policy_to_endpoints to preview assignment.', body);
    } catch (error) {
      const status = error instanceof MagicSwordApiError ? ` (HTTP ${error.status})` : '';
      return textError(`Policy cloning failed${status}. Requires policies:write and access to the source content. ${reconcile}`);
    }
  },
});
