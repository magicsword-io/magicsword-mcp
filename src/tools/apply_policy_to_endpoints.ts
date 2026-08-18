import { z } from 'zod';
import { defineTool, formatApiError, textError, textOk } from './shared.js';

export const applyPolicyToEndpointsTool = defineTool({
  name: 'apply_policy_to_endpoints',
  title: 'Assign a policy to endpoints',
  description:
    'Resolves either an explicit endpoint_ids list or a hostname_pattern (glob) into a concrete set of endpoints, ' +
    'then previews the concrete assignment. Rerun with confirm=true after human approval to apply it.',
  inputSchema: {
    policy_id: z.string().uuid().describe('The policy UUID to assign'),
    endpoint_ids: z
      .array(z.string().uuid())
      .min(1)
      .max(500)
      .optional()
      .describe('Explicit list of endpoint UUIDs. Mutually exclusive with hostname_pattern.'),
    hostname_pattern: z
      .string()
      .min(1)
      .max(255)
      .optional()
      .describe('Glob pattern (case-insensitive) matched against computer_name. Mutually exclusive with endpoint_ids.'),
    platform: z
      .enum(['windows', 'macos', 'linux'])
      .optional()
      .describe('Optional platform filter, applied when resolving hostname_pattern'),
    confirm: z.boolean().optional().describe('Set true only after a human approves the resolved preview'),
  },
  async handler({ policy_id, endpoint_ids, hostname_pattern, platform, confirm }, { client }) {
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
        targetEndpoints = endpoint_ids.map((id) => ({
          id,
          computer_name: null,
        }));
      } else if (hostname_pattern) {
        const result = await client.endpoints({
          platform,
          hostname_pattern,
          limit: 500,
        });
        if (result.total > result.endpoints.length) {
          return textError(
            `Hostname pattern matched ${result.total} endpoints, above the 500-endpoint assignment limit. ` +
              'Narrow the pattern or assign explicit endpoint IDs.',
          );
        }
        targetEndpoints = result.endpoints.map((e) => ({
          id: e.id,
          computer_name: e.computer_name,
        }));
      }

      if (targetEndpoints.length === 0) {
        return textOk(`No endpoints matched. Nothing to assign. (policy_id=${policy_id})`, {
          policy_id,
          would_assign: [],
        });
      }

      const list = targetEndpoints.map((e) => `  - ${e.computer_name ?? '(no name)'}  ${e.id}`).join('\n');

      if (confirm !== true) {
        return textOk(
          `PREVIEW — would assign policy ${policy_id} (${policy.platform}) to ${targetEndpoints.length} endpoint(s):\n${list}\n` +
            'No changes were made. Re-run with confirm=true after human approval.',
          { policy_id, would_assign: targetEndpoints, requires_confirmation: true },
        );
      }

      const response = await client.assignPolicyToEndpoints(
        policy_id,
        targetEndpoints.map((e) => e.id),
      );

      return textOk(
        `Assigned policy ${policy_id} (${policy.platform}) to ${targetEndpoints.length} endpoint(s):\n${list}`,
        {
          policy_id,
          assigned: targetEndpoints,
          response: response as Record<string, unknown>,
        },
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
});
