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

export const allTools = [
  whoamiTool,
  listEndpointsTool,
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
