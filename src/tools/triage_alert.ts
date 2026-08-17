import { z } from 'zod';
import { defineTool, formatApiError, textError, textOk } from './shared.js';
import type { Alert } from '../types.js';

function summarize(alert: Alert): string {
  const lines: string[] = [];
  lines.push(`Alert ${alert.id}`);
  if (alert.severity) lines.push(`Severity: ${alert.severity}`);
  if (alert.title) lines.push(`Title: ${alert.title}`);
  const endpoint = alert.endpoint_name ?? alert.endpoint_names?.join(', ');
  if (endpoint) lines.push(`Endpoint: ${endpoint}`);
  if (alert.created_at) lines.push(`When: ${alert.created_at}`);
  const technique = Array.isArray(alert.mitre_techniques) ? alert.mitre_techniques.join(', ') : null;
  if (technique) lines.push(`MITRE: ${technique}`);
  if (alert.acknowledged_at) {
    lines.push(`ACKED at ${alert.acknowledged_at}${alert.acknowledged_by ? ` by ${alert.acknowledged_by}` : ''}`);
  } else {
    lines.push(`Status: UNACKED`);
  }
  if (alert.description) lines.push(`\nDescription:\n${alert.description}`);
  if (alert.file_path) lines.push(`File path: ${alert.file_path}`);
  if (alert.file_hash) lines.push(`File hash: ${alert.file_hash}`);
  if (alert.publisher) lines.push(`Publisher: ${alert.publisher}`);
  if (alert.triggering_events?.length) {
    lines.push(`\nTriggering events:\n${JSON.stringify(alert.triggering_events, null, 2)}`);
  }
  if (alert.metadata && Object.keys(alert.metadata).length > 0) {
    lines.push(`\nMetadata:\n${JSON.stringify(alert.metadata, null, 2)}`);
  }
  return lines.join('\n');
}

export const triageAlertTool = defineTool({
  name: 'triage_alert',
  title: 'Triage a single MagicSword alert',
  description:
    'Fetches one alert directly by id and returns its severity, endpoint, MITRE mapping, triggering events, ' +
    'file context, and metadata for analyst review. Optionally acknowledges or dismisses it.',
  inputSchema: {
    alert_id: z.string().uuid().describe('The alert UUID (returned from find_alerts)'),
    ack: z.boolean().optional().describe('If true, mark the alert acknowledged. Requires alerts:write.'),
    ack_comment: z
      .string()
      .max(1000)
      .optional()
      .describe('Comment to record on acknowledgement (only meaningful with ack: true)'),
    dismiss: z
      .boolean()
      .optional()
      .describe('If true, dismiss the alert instead of acknowledging it. Requires alerts:write.'),
    dismiss_reason: z.string().max(1000).optional().describe('Reason to record when dismissing the alert'),
  },
  async handler({ alert_id, ack, ack_comment, dismiss, dismiss_reason }, { client }) {
    try {
      const { alert } = await client.alert(alert_id);
      let summary = summarize(alert);
      if (dismiss && ack) {
        return textError('Use either ack=true or dismiss=true, not both.');
      }
      if (dismiss) {
        const response = await client.dismissAlert(alert_id, dismiss_reason);
        summary += `\n\nDismissed alert${dismiss_reason ? ` with reason: "${dismiss_reason}"` : ''}.`;
        return textOk(summary, {
          alert,
          dismissal: response as Record<string, unknown>,
        });
      }
      if (ack) {
        const response = await client.acknowledgeAlert(alert_id, ack_comment);
        summary += `\n\nAcknowledged alert${ack_comment ? ` with comment: "${ack_comment}"` : ''}.`;
        return textOk(summary, {
          alert,
          acknowledgement: response as Record<string, unknown>,
        });
      }
      return textOk(summary, alert as unknown as Record<string, unknown>);
    } catch (err) {
      return formatApiError(err);
    }
  },
});
