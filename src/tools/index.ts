import { whoamiTool } from './whoami.js';
import { listEndpointsTool } from './list_endpoints.js';
import { findAlertsTool } from './find_alerts.js';
import { listEventsTool } from './list_events.js';
import { triageAlertTool } from './triage_alert.js';
import { listPoliciesTool } from './list_policies.js';
import { showPolicyTool } from './show_policy.js';
import { managePolicyRulesTool } from './manage_policy_rules.js';
import { applyPolicyToEndpointsTool } from './apply_policy_to_endpoints.js';
import { flipToEnforcingTool } from './flip_to_enforcing.js';
import { mintEnrollmentTokenTool } from './mint_enrollment_token.js';
import { agentInstallInstructionsTool } from './agent_install_instructions.js';
import { listCustomerIntelFeedsTool } from './list_customer_intel_feeds.js';
import { manageCustomerIntelFeedTool } from './manage_customer_intel_feed.js';
import { manageCustomerIntelItemTool } from './manage_customer_intel_item.js';
import { upsertCustomerIntelItemsTool } from './upsert_customer_intel_items.js';
import { managePolicyIntelSourcesTool } from './manage_policy_intel_sources.js';
import { upgradeEndpointsTool } from './upgrade_endpoints.js';
import { requestEndpointCheckinTool } from './request_endpoint_checkin.js';
import { showEndpointTool } from './show_endpoint.js';
import { listAgentReleasesTool } from './list_agent_releases.js';
import type { ToolAnnotations } from '@modelcontextprotocol/server';

export const allTools = [
  whoamiTool,
  listEndpointsTool,
  showEndpointTool,
  listAgentReleasesTool,
  findAlertsTool,
  listEventsTool,
  triageAlertTool,
  listPoliciesTool,
  showPolicyTool,
  managePolicyRulesTool,
  applyPolicyToEndpointsTool,
  flipToEnforcingTool,
  listCustomerIntelFeedsTool,
  manageCustomerIntelFeedTool,
  manageCustomerIntelItemTool,
  upsertCustomerIntelItemsTool,
  managePolicyIntelSourcesTool,
  upgradeEndpointsTool,
  requestEndpointCheckinTool,
  mintEnrollmentTokenTool,
  agentInstallInstructionsTool,
];

const READ_ONLY_TOOLS = new Set([
  'whoami',
  'list_endpoints',
  'show_endpoint',
  'list_agent_releases',
  'find_alerts',
  'list_events',
  'list_policies',
  'show_policy',
  'list_customer_intel_feeds',
  'agent_install_instructions',
]);

const DESTRUCTIVE_TOOLS = new Set([
  'triage_alert',
  'manage_policy_rules',
  'apply_policy_to_endpoints',
  'flip_to_enforcing',
  'manage_customer_intel_feed',
  'manage_customer_intel_item',
  'manage_policy_intel_sources',
  'upgrade_endpoints',
]);

export function annotationsForTool(name: string): ToolAnnotations {
  const readOnly = READ_ONLY_TOOLS.has(name);
  return {
    readOnlyHint: readOnly,
    destructiveHint: readOnly ? false : DESTRUCTIVE_TOOLS.has(name),
    idempotentHint: readOnly,
    openWorldHint: false,
  };
}
