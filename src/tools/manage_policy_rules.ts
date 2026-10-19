import { z } from 'zod';
import { defineTool, formatApiError, textError, textOk } from './shared.js';
import { addPolicyRulesResultSchema, policyRuleSchema, policyRuleTypeSchema } from '../policy-rules.js';

export const managePolicyRulesTool = defineTool({
  name: 'manage_policy_rules',
  title: 'List or add policy rules',
  description:
    'Lists rules stored on the current policy version, including materialized feed rules, or appends/updates explicit or event-derived rules while preserving existing rules and feed links. ' +
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
      .trim()
      .min(1)
      .max(255)
      .optional()
      .describe('Policy current-version name for add when policy_id is unknown.'),
    platform: z.enum(['windows', 'macos', 'linux']).optional().describe('Disambiguates policy_name matches'),
    rules: z.array(policyRuleSchema).min(1).max(100).optional().describe('Explicit rules to add/update'),
    event_ids: z.array(z.string().uuid()).min(1).max(100).optional().describe('Telemetry event IDs to turn into rules'),
    status: z
      .enum(['allowed', 'blocked', 'disabled'])
      .optional()
      .describe('Status for event-derived rules; defaults to allowed'),
    type: policyRuleTypeSchema.optional().describe('Optional rule type override for event-derived rules'),
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

      if (rules !== undefined && event_ids !== undefined) {
        return textError('Provide exactly one of rules or event_ids; the Portal selects event_ids whenever that field is present.');
      }
      if (rules && (status !== undefined || type !== undefined)) {
        return textError('Top-level status and type apply only to event_ids. Set type and status on each explicit rule.');
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
      const parsed = addPolicyRulesResultSchema.safeParse(result);
      if (!parsed.success) {
        return textError('The Portal returned an invalid rule-change response; the outcome could not be verified. List the current rules before retrying; a new version may already have been created.');
      }
      const { added_count: added, updated_count: updated, duplicate_count: duplicates } = parsed.data;
      if (added === 0 && updated === 0 && duplicates === 0) {
        return {
          ...textError('The Portal reported 0 rules added and 0 updated for a non-empty request. List the current rules and inspect the policy version before retrying; a new version may already have been created.'),
          structuredContent: result as Record<string, unknown>,
        };
      }
      const summary = added === 0 && updated === 0
        ? `No changes needed: ${duplicates} rule(s) already exist with the same status.`
        : `Updated policy rules: added ${added}, updated ${updated}, already unchanged ${duplicates}.`;
      return textOk(summary, result as Record<string, unknown>);
    } catch (err) {
      return formatApiError(err);
    }
  },
});
