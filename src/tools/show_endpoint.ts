import { z } from 'zod';
import { defineTool, formatApiError, textOk } from './shared.js';

export const showEndpointTool = defineTool({
  name: 'show_endpoint',
  title: 'Show a single MagicSword endpoint',
  description:
    'Fetches one endpoint directly by UUID with OS, architecture, policy, compliance, agent version, ' +
    'upgrade state, heartbeat, and AMSI details. Requires endpoints:read.',
  inputSchema: {
    endpoint_id: z.string().uuid().describe('Endpoint UUID returned by list_endpoints'),
  },
  async handler({ endpoint_id }, { client }) {
    try {
      const { endpoint } = await client.endpoint(endpoint_id);
      const lines = [
        `${endpoint.computer_name ?? '(unnamed)'} (${endpoint.id})`,
        `Platform: ${endpoint.platform} ${endpoint.os_version ?? ''} ${endpoint.architecture ?? ''}`.trim(),
        `Lifecycle: ${endpoint.status ?? 'unknown'}; compliance: ${endpoint.compliance_status ?? 'unknown'}`,
        `Agent: ${endpoint.installer_version ?? 'unknown'}`,
        `Policy: ${endpoint.policy_id ?? endpoint.macos_policy_id ?? '(none)'}`,
        `Last check-in: ${endpoint.last_checkin ?? endpoint.last_heartbeat ?? 'never'}`,
        `Upgrade: ${endpoint.update_status ?? 'none'}; target: ${endpoint.update_target_version ?? 'none'}`,
      ];
      if (endpoint.update_error_code) lines.push(`Upgrade error: ${endpoint.update_error_code}`);
      if (endpoint.amsi_enabled !== undefined && endpoint.amsi_enabled !== null) {
        lines.push(
          `AMSI: ${endpoint.amsi_enabled ? 'enabled' : 'disabled'}; rules: ${endpoint.amsi_rules_version ?? 'unknown'}; detections: ${endpoint.amsi_detection_count ?? 0}`,
        );
      }
      return textOk(lines.join('\n'), endpoint as unknown as Record<string, unknown>);
    } catch (error) {
      return formatApiError(error);
    }
  },
});
