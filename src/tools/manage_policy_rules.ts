import { z } from 'zod';
import { defineTool, formatApiError, textError, textOk } from './shared.js';

const ruleSchema = z
  .record(z.string(), z.unknown())
  .describe(
    'Policy rule. Common Windows WDAC shapes: {type:"filepath", value:"%OSDRIVE%\\\\Tools\\\\tool.exe", status:"blocked"}, {type:"filename", value:"tool.exe", status:"blocked"}, or {type:"publisher", value:{publisherName, signerName, tbsHash}, status:"allowed"}. Do not create explicit type:"hash" rules for Windows WDAC; use event_ids or private intel feeds for hash/AuthentiHash/page-hash IOCs.',
  );

export const managePolicyRulesTool = defineTool({
  name: 'manage_policy_rules',
  title: 'List or add policy rules',
  description:
    'Lists policy rules or creates a new policy version with explicit rules or event-derived rules. ' +
    'Use event_ids with status=allowed for “allow all these audit events on my policy”; the Portal will derive supported policy rules when possible. ' +
    'Do not add explicit flat file-hash rules for Windows WDAC. Requires policies:read for list and policies:write for add.',
  inputSchema: {
    action: z.enum(['list', 'add']),
    policy_id: z
      .string()
      .uuid()
      .optional()
      .describe('Policy UUID. Required for list; optional for add if policy_name is provided.'),
    policy_name: z
      .string()
      .min(1)
      .max(4096)
      .optional()
      .describe('Policy current-version name for add when policy_id is unknown.'),
    platform: z.enum(['windows', 'macos', 'linux']).optional().describe('Disambiguates policy_name matches'),
    rules: z.array(ruleSchema).max(100).optional().describe('Explicit rules to add/update'),
    event_ids: z.array(z.string().uuid()).max(100).optional().describe('Telemetry event IDs to turn into rules'),
    status: z
      .enum(['allowed', 'blocked', 'disabled'])
      .optional()
      .describe('Status for event-derived rules; defaults to allowed'),
    type: z.string().max(4096).optional().describe('Optional rule type override for event-derived rules'),
    limit: z.number().int().positive().max(500).optional(),
    offset: z.number().int().min(0).optional(),
  },
  async handler(
    { action, policy_id, policy_name, platform, rules, event_ids, status, type, limit, offset },
    { client },
  ) {
    try {
      if (action === 'list') {
        if (!policy_id) return textError('policy_id is required when action=list.');
        const result = await client.policyRules(policy_id, { limit, offset });
        return textOk(`Listed rules for policy ${policy_id}.`, result as Record<string, unknown>);
      }

      if (!policy_id && !policy_name) return textError('policy_id or policy_name is required when action=add.');
      if ((!rules || rules.length === 0) && (!event_ids || event_ids.length === 0)) {
        return textError('Provide rules or event_ids when action=add.');
      }

      const result = await client.addPolicyRules({
        policy_id,
        policy_name,
        platform,
        rules,
        event_ids,
        status,
        type,
      });
      return textOk(`Updated policy rules${policy_id ? ` for ${policy_id}` : ''}.`, result as Record<string, unknown>);
    } catch (err) {
      return formatApiError(err);
    }
  },
});
