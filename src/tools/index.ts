import { whoamiTool } from './whoami.js';
import { listEndpointsTool } from './list_endpoints.js';
import { findAlertsTool } from './find_alerts.js';
import { triageAlertTool } from './triage_alert.js';
import { listPoliciesTool } from './list_policies.js';
import { showPolicyTool } from './show_policy.js';
import { applyPolicyToEndpointsTool } from './apply_policy_to_endpoints.js';
import { flipToEnforcingTool } from './flip_to_enforcing.js';
import { mintEnrollmentTokenTool } from './mint_enrollment_token.js';
import { agentInstallInstructionsTool } from './agent_install_instructions.js';

export const allTools = [
  whoamiTool,
  listEndpointsTool,
  findAlertsTool,
  triageAlertTool,
  listPoliciesTool,
  showPolicyTool,
  applyPolicyToEndpointsTool,
  flipToEnforcingTool,
  mintEnrollmentTokenTool,
  agentInstallInstructionsTool,
];
