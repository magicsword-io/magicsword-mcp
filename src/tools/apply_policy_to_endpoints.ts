import { z } from 'zod';
import { defineTool, formatApiError, globToRegex, textError, textOk } from './shared.js';

export const applyPolicyToEndpointsTool = defineTool({
  name: 'apply_policy_to_endpoints',
  title: 'Assign a policy to endpoints (preview-only until write API ships)',
  description:
    'Resolves either an explicit endpoint_ids list or a hostname_pattern (glob) into a concrete set of endpoints, ' +
    'and would assign the named policy to them. The assign-policy route is not in the customer API yet — until it ' +
    'ships this tool returns a preview ("would-assign" list) and a clear "coming soon" notice. ' +
    'Use this to plan rollouts safely while the write side is in flight.',
  inputSchema: {
    policy_id: z.string().min(1).describe('The policy UUID to assign'),
    endpoint_ids: z.array(z.string().min(1)).optional()
      .describe('Explicit list of endpoint UUIDs. Mutually exclusive with hostname_pattern.'),
    hostname_pattern: z.string().optional()
      .describe('Glob pattern (case-insensitive) matched against computer_name. Mutually exclusive with endpoint_ids.'),
    platform: z.enum(['windows', 'macos', 'linux']).optional()
      .describe('Optional platform filter, applied when resolving hostname_pattern'),
  },
  async handler({ policy_id, endpoint_ids, hostname_pattern, platform }, { client }) {
    if (!endpoint_ids?.length && !hostname_pattern) {
      return textError('Must supply either endpoint_ids or hostname_pattern.');
    }
    if (endpoint_ids?.length && hostname_pattern) {
      return textError('Supply endpoint_ids OR hostname_pattern, not both.');
    }
    try {
      // Confirm the policy exists & matches platform.
      const policies = await client.policies({ platform });
      const policy = policies.policies.find((p) => p.id === policy_id);
      if (!policy) {
        return textError(
          `Policy ${policy_id} not found in this org${platform ? ` for platform ${platform}` : ''}. ` +
            `Run list_policies first.`,
        );
      }

      let targetEndpoints: { id: string; computer_name: string | null }[] = [];

      if (endpoint_ids?.length) {
        targetEndpoints = endpoint_ids.map((id) => ({ id, computer_name: null }));
      } else if (hostname_pattern) {
        const re = globToRegex(hostname_pattern);
        const result = await client.endpoints({ platform, limit: 500 });
        targetEndpoints = result.endpoints
          .filter((e) => e.computer_name && re.test(e.computer_name))
          .map((e) => ({ id: e.id, computer_name: e.computer_name }));
      }

      if (targetEndpoints.length === 0) {
        return textOk(
          `No endpoints matched. Nothing to assign. (policy_id=${policy_id})`,
          { policy_id, would_assign: [] },
        );
      }

      const list = targetEndpoints
        .map((e) => `  - ${e.computer_name ?? '(no name)'}  ${e.id}`)
        .join('\n');

      const note =
        `\n\n[coming soon] The customer API does not yet expose policy assignment. ` +
        `When the write endpoint ships, this tool will POST the assignment automatically. ` +
        `For now, paste this list into the Magic Portal manually or use the agent CLI.`;

      return textOk(
        `Would assign policy ${policy_id} (${policy.platform}) to ${targetEndpoints.length} endpoint(s):\n${list}${note}`,
        { policy_id, would_assign: targetEndpoints },
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
});
