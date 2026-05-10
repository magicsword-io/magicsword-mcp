import { z } from 'zod';
import { defineTool, formatApiError, textError, textOk } from './shared.js';
import type { Alert } from '../types.js';

/**
 * The /api/public/v1/alerts route does not currently support fetch-by-id, and
 * Plan A's first PR ships read-only alerts (no ack endpoint). We page through
 * recent alerts to locate the requested one and return its evidence + process
 * chain in an LLM-readable form. If `ack: true` is requested we surface a
 * clear "write scope coming soon" message rather than reaching into a
 * different (internal) auth surface.
 */
const PAGE_SIZE = 200;
const MAX_PAGES = 5; // bounded scan; user can pass `since` to narrow the window

async function findAlert(
  client: import('../client.js').MagicSwordClient,
  alertId: string,
  since: string | undefined,
): Promise<Alert | undefined> {
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await client.alerts({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      since,
    });
    const hit = result.alerts.find((a) => a.id === alertId);
    if (hit) return hit;
    if (result.alerts.length < PAGE_SIZE) return undefined;
    if ((page + 1) * PAGE_SIZE >= result.total) return undefined;
  }
  return undefined;
}

function summarize(alert: Alert): string {
  const lines: string[] = [];
  lines.push(`Alert ${alert.id}`);
  if (alert.severity) lines.push(`Severity: ${alert.severity}`);
  if (alert.title) lines.push(`Title: ${alert.title}`);
  if (alert.computer_name) lines.push(`Endpoint: ${alert.computer_name}`);
  if (alert.created_at) lines.push(`When: ${alert.created_at}`);
  const technique =
    alert.mitre_technique ??
    (Array.isArray(alert.mitre_techniques) ? alert.mitre_techniques.join(', ') : null);
  if (technique) lines.push(`MITRE: ${technique}`);
  if (alert.acknowledged_at) {
    lines.push(`ACKED at ${alert.acknowledged_at}${alert.acknowledged_by ? ` by ${alert.acknowledged_by}` : ''}`);
    if (alert.ack_comment) lines.push(`Ack comment: ${alert.ack_comment}`);
  } else {
    lines.push(`Status: UNACKED`);
  }
  if (alert.description) lines.push(`\nDescription:\n${alert.description}`);
  if (alert.process_chain !== undefined && alert.process_chain !== null) {
    lines.push(`\nProcess chain:\n${JSON.stringify(alert.process_chain, null, 2)}`);
  }
  if (alert.evidence !== undefined && alert.evidence !== null) {
    lines.push(`\nEvidence:\n${JSON.stringify(alert.evidence, null, 2)}`);
  }
  return lines.join('\n');
}

export const triageAlertTool = defineTool({
  name: 'triage_alert',
  title: 'Triage a single MagicSword alert',
  description:
    'Looks up a single alert by id, returns severity, MITRE mapping, process chain, and evidence in a form ' +
    'suitable for an LLM to summarize for a human analyst. Optionally acknowledges with a comment. ' +
    'Pass `since` to narrow the search window when the alert is older than the last few hundred records.',
  inputSchema: {
    alert_id: z.string().min(1)
      .describe('The alert UUID (returned from find_alerts)'),
    since: z.string().optional()
      .describe('ISO8601 lower bound to narrow the search window if the alert is older'),
    ack: z.boolean().optional()
      .describe('If true, mark the alert acknowledged. Note: ack is not yet supported by the public API — this will return a clear "coming soon" notice.'),
    ack_comment: z.string().optional()
      .describe('Comment to record on acknowledgement (only meaningful with ack: true)'),
  },
  async handler({ alert_id, since, ack, ack_comment }, { client }) {
    try {
      const alert = await findAlert(client, alert_id, since);
      if (!alert) {
        return textError(
          `Alert ${alert_id} was not found in the most recent ${MAX_PAGES * PAGE_SIZE} alerts. ` +
            `If it is older, pass a \`since\` ISO8601 timestamp to widen the search window.`,
        );
      }
      let summary = summarize(alert);
      if (ack) {
        const ackNote =
          `\n\n[ack requested] The MagicSword public API does not yet expose alert acknowledgement ` +
          `(the alerts:write scope exists but the route ships in a follow-up PR). ` +
          `Recorded request${ack_comment ? ` with comment: "${ack_comment}"` : ''} — please retry once the write endpoint is live.`;
        summary += ackNote;
      }
      return textOk(summary, alert as unknown as Record<string, unknown>);
    } catch (err) {
      return formatApiError(err);
    }
  },
});
