import { z } from 'zod';
import { defineTool, formatApiError, globToRegex, textOk } from './shared.js';
import type { Alert } from '../types.js';

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;

function alertMatchesTechnique(alert: Alert, needle: string): boolean {
  const n = needle.toUpperCase();
  if (alert.mitre_technique && alert.mitre_technique.toUpperCase().includes(n)) return true;
  if (Array.isArray(alert.mitre_techniques)) {
    return alert.mitre_techniques.some((t) => typeof t === 'string' && t.toUpperCase().includes(n));
  }
  return false;
}

export const findAlertsTool = defineTool({
  name: 'find_alerts',
  title: 'Find MagicSword alerts',
  description:
    'Search MagicSword alerts by severity, ack state, time window, hostname, or MITRE technique. ' +
    'The portal API filters server-side on severity / acknowledged / since; hostname and mitre_technique ' +
    'are filtered client-side after fetching the page. Use this for triage queries like "unack\'d critical alerts in the last 24h".',
  inputSchema: {
    severity: z.enum(SEVERITIES).optional()
      .describe('Restrict to one severity tier'),
    acknowledged: z.boolean().optional()
      .describe('true = only acked alerts, false = only unacked, omit = both'),
    since: z.string().optional()
      .describe('ISO8601 lower bound on created_at (e.g. "2026-05-08T00:00:00Z" or "2026-05-09")'),
    hostname: z.string().optional()
      .describe('Glob pattern matched case-insensitively against the alert\'s computer_name (client-side)'),
    mitre_technique: z.string().optional()
      .describe('Substring match (case-insensitive) against mitre_technique / mitre_techniques (e.g. "T1059")'),
    limit: z.number().int().min(1).max(200).optional()
      .describe('Page size (default 50, max 200). Client-side filters are applied AFTER paging.'),
    offset: z.number().int().min(0).optional()
      .describe('Skip this many records before returning'),
  },
  async handler({ severity, acknowledged, since, hostname, mitre_technique, limit, offset }, { client }) {
    try {
      const page = await client.alerts({ severity, acknowledged, since, limit, offset });
      let alerts: Alert[] = page.alerts;
      const filterNotes: string[] = [];
      if (hostname) {
        const re = globToRegex(hostname);
        const before = alerts.length;
        alerts = alerts.filter((a) => a.computer_name && re.test(a.computer_name));
        filterNotes.push(`hostname kept ${alerts.length}/${before}`);
      }
      if (mitre_technique) {
        const before = alerts.length;
        alerts = alerts.filter((a) => alertMatchesTechnique(a, mitre_technique));
        filterNotes.push(`mitre_technique kept ${alerts.length}/${before}`);
      }
      const note = filterNotes.length ? ` (client-side: ${filterNotes.join(', ')})` : '';
      if (alerts.length === 0) {
        return textOk(
          `No alerts matched on this page. Server returned ${page.total} total before client-side filters${note}.`,
          { alerts: [], total: page.total, limit: page.limit, offset: page.offset },
        );
      }
      const lines = alerts.map((a) => {
        const ack = a.acknowledged_at ? `ACKED at ${a.acknowledged_at}` : 'UNACKED';
        const technique =
          a.mitre_technique ??
          (Array.isArray(a.mitre_techniques) ? a.mitre_techniques.join(',') : null);
        return [
          `- [${a.severity ?? 'unknown'}] ${a.title ?? '(no title)'}`,
          `    id: ${a.id}`,
          `    when: ${a.created_at}  host: ${a.computer_name ?? '(unknown)'}  ${ack}`,
          technique ? `    mitre: ${technique}` : null,
        ]
          .filter(Boolean)
          .join('\n');
      });
      return textOk(
        `Showing ${alerts.length} of ${page.total} total${note}.\n\n${lines.join('\n')}`,
        { alerts, total: page.total, limit: page.limit, offset: page.offset },
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
});
