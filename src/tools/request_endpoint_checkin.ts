import { z } from 'zod';
import { defineTool, formatApiError, textOk } from './shared.js';

export const requestEndpointCheckinTool = defineTool({
  name: 'request_endpoint_checkin',
  title: 'Request endpoint check-in',
  description: 'Queues a check-in command for one endpoint. Requires endpoints:write.',
  inputSchema: {
    endpoint_id: z.string().uuid().describe('Endpoint UUID'),
  },
  async handler({ endpoint_id }, { client }) {
    try {
      const result = await client.checkinEndpoint(endpoint_id);
      return textOk(`Queued check-in for endpoint ${endpoint_id}.`, result as Record<string, unknown>);
    } catch (err) {
      return formatApiError(err);
    }
  },
});
