import { z } from 'zod';
import { defineTool, formatApiError, textOk } from './shared.js';

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

export const findAlertsTool = defineTool({
  name: 'find_alerts',
  title: 'Find MagicSword alerts',
  description:
    'Search MagicSword alerts by severity, ack state, time window, hostname, or MITRE technique. ' +
    'All filters run server-side before pagination, so total and page counts describe the actual result set. ' +
    'Use this for triage queries like "unack\'d critical alerts in the last 24h".',
  inputSchema: {
    severity: z.enum(SEVERITIES).optional().describe('Restrict to one severity tier'),
    acknowledged: z.boolean().optional().describe('true = only acked alerts, false = only unacked, omit = both'),
    since: z
      .string()
      .optional()
      .describe('ISO8601 lower bound on created_at (e.g. "2026-05-08T00:00:00Z" or "2026-05-09")'),
    hostname: z
      .string()
      .min(1)
      .max(255)
      .optional()
      .describe('Glob matched case-insensitively against endpoint name, e.g. "prod-*"'),
    mitre_technique: z
      .string()
      .regex(/^T\d{4}(?:\.\d{3})?$/i)
      .optional()
      .describe('Exact MITRE ATT&CK technique or sub-technique, e.g. "T1059" or "T1059.001"'),
    limit: z.number().int().min(1).max(200).optional().describe('Page size (default 50, max 200)'),
    offset: z.number().int().min(0).optional().describe('Skip this many records before returning'),
  },
  async handler({ severity, acknowledged, since, hostname, mitre_technique, limit, offset }, { client }) {
    try {
      const page = await client.alerts({
        severity,
        acknowledged,
        since,
        hostname_pattern: hostname,
        mitre_technique,
        limit,
        offset,
      });
      const alerts = page.alerts;
      if (alerts.length === 0) {
        return textOk(`No alerts matched this page. The filtered result set contains ${page.total} alert(s).`, {
          alerts: [],
          total: page.total,
          limit: page.limit,
          offset: page.offset,
        });
      }
      const lines = alerts.map((a) => {
        const ack = a.acknowledged_at ? `ACKED at ${a.acknowledged_at}` : 'UNACKED';
        const technique = Array.isArray(a.mitre_techniques) ? a.mitre_techniques.join(',') : null;
        const endpoint = a.endpoint_name ?? a.endpoint_names?.join(', ') ?? '(unknown)';
        return [
          `- [${a.severity ?? 'unknown'}] ${a.title ?? '(no title)'}`,
          `    id: ${a.id}`,
          `    when: ${a.created_at}  endpoint: ${endpoint}  ${ack}`,
          technique ? `    mitre: ${technique}` : null,
        ]
          .filter(Boolean)
          .join('\n');
      });
      return textOk(`Showing ${alerts.length} of ${page.total} filtered alert(s).\n\n${lines.join('\n')}`, {
        alerts,
        total: page.total,
        limit: page.limit,
        offset: page.offset,
      });
    } catch (err) {
      return formatApiError(err);
    }
  },
});
