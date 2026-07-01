import { request as undiciRequest } from 'undici';
import type {
  AlertsResponse,
  ApiErrorBody,
  CustomerIntelFeedsResponse,
  CustomerIntelItemsResponse,
  EndpointsResponse,
  EventsResponse,
  EnrollmentTokenResponse,
  MeResponse,
  PolicyDetailResponse,
  PoliciesResponse,
} from './types.js';

export interface ClientConfig {
  baseUrl: string;
  apiKey: string;
  userAgent?: string;
}

export class MagicSwordApiError extends Error {
  status: number;
  feature?: string;
  body: unknown;
  url: string;

  constructor(status: number, body: unknown, url: string) {
    const parsed = (body && typeof body === 'object' ? (body as ApiErrorBody) : null);
    const message = parsed?.error ?? `HTTP ${status} from ${url}`;
    super(message);
    this.name = 'MagicSwordApiError';
    this.status = status;
    this.feature = parsed?.feature;
    this.body = body;
    this.url = url;
  }

  /** True if this is a plan-gate (403 + feature: 'customerApi'). */
  get isPlanGate(): boolean {
    return this.status === 403 && this.feature === 'customerApi';
  }

  /** True if the API key is missing/revoked/wrong format. */
  get isAuthFailure(): boolean {
    return this.status === 401;
  }

  /** True if the key is valid but missing the scope required for this call. */
  get isScopeFailure(): boolean {
    return this.status === 403 && this.feature !== 'customerApi';
  }
}

export class MagicSwordClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly userAgent: string;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.userAgent = config.userAgent ?? 'magicsword-mcp/0.1';
  }

  private async req<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    options: { query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/public/v1${path}`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value === undefined || value === null || value === '') continue;
        url.searchParams.set(key, String(value));
      }
    }

    const response = await undiciRequest(url.toString(), {
      method,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        accept: 'application/json',
        'user-agent': this.userAgent,
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const text = await response.body.text();
    let parsed: unknown = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { error: text };
      }
    }

    if (response.statusCode >= 400) {
      throw new MagicSwordApiError(response.statusCode, parsed, url.toString());
    }

    return parsed as T;
  }

  me(): Promise<MeResponse> {
    return this.req<MeResponse>('GET', '/me');
  }

  policies(query: { platform?: string } = {}): Promise<PoliciesResponse> {
    return this.req<PoliciesResponse>('GET', '/policies', { query });
  }

  policy(policyId: string): Promise<PolicyDetailResponse> {
    return this.req<PolicyDetailResponse>('GET', `/policies/${policyId}`);
  }

  policyRules(policyId: string, query: { limit?: number; offset?: number } = {}): Promise<unknown> {
    return this.req('GET', `/policies/${policyId}/rules`, { query });
  }

  addPolicyRules(body: {
    policy_id?: string;
    policy_name?: string;
    platform?: string;
    rules?: unknown[];
    event_ids?: string[];
    status?: 'allowed' | 'blocked' | 'disabled';
    type?: string;
  }): Promise<unknown> {
    if (body.policy_id) {
      return this.req('POST', `/policies/${body.policy_id}/rules`, { body });
    }
    return this.req('POST', '/policies/rules', { body });
  }

  enforcePreview(policyId: string, acknowledgeBlockers = false): Promise<unknown> {
    return this.req('POST', `/policies/${policyId}/enforce-preview`, {
      body: { acknowledge_blockers: acknowledgeBlockers },
    });
  }

  enforcePolicy(policyId: string, confirmationToken: string): Promise<unknown> {
    return this.req('POST', `/policies/${policyId}/enforce`, {
      body: { confirmation_token: confirmationToken },
    });
  }

  alerts(query: {
    severity?: string;
    acknowledged?: boolean;
    since?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<AlertsResponse> {
    return this.req<AlertsResponse>('GET', '/alerts', {
      query: {
        severity: query.severity,
        acknowledged: query.acknowledged === undefined ? undefined : String(query.acknowledged),
        since: query.since,
        limit: query.limit,
        offset: query.offset,
      },
    });
  }

  endpoints(query: {
    platform?: string;
    status?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<EndpointsResponse> {
    return this.req<EndpointsResponse>('GET', '/endpoints', { query });
  }

  events(query: {
    hours?: number;
    since?: string;
    status?: string;
    type?: string;
    platform?: string;
    endpoint_id?: string;
    policy_id?: string;
    q?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<EventsResponse> {
    return this.req<EventsResponse>('GET', '/events', { query });
  }

  mintEnrollmentToken(body: { ttl_seconds?: number } = {}): Promise<EnrollmentTokenResponse> {
    return this.req<EnrollmentTokenResponse>('POST', '/enrollment-tokens', { body });
  }

  assignPolicyToEndpoints(policyId: string, endpointIds: string[]): Promise<unknown> {
    return this.req('POST', `/policies/${policyId}/assign-endpoints`, {
      body: { endpoint_ids: endpointIds },
    });
  }

  acknowledgeAlert(alertId: string, comment?: string): Promise<unknown> {
    return this.req('POST', `/alerts/${alertId}/acknowledge`, {
      body: comment ? { comment } : {},
    });
  }

  dismissAlert(alertId: string, reason?: string): Promise<unknown> {
    return this.req('POST', `/alerts/${alertId}/dismiss`, {
      body: reason ? { reason } : {},
    });
  }

  intelFeeds(query: { limit?: number; offset?: number } = {}): Promise<CustomerIntelFeedsResponse> {
    return this.req<CustomerIntelFeedsResponse>('GET', '/intel/feeds', { query });
  }

  createIntelFeed(body: {
    name: string;
    description?: string;
    platforms?: string[];
    is_enabled?: boolean;
  }): Promise<{ feed: unknown }> {
    return this.req('POST', '/intel/feeds', { body });
  }

  updateIntelFeed(feedId: string, body: {
    name?: string;
    description?: string;
    platforms?: string[];
    is_enabled?: boolean;
  }): Promise<{ feed: unknown }> {
    return this.req('PATCH', `/intel/feeds/${feedId}`, { body });
  }

  deleteIntelFeed(feedId: string): Promise<unknown> {
    return this.req('DELETE', `/intel/feeds/${feedId}`);
  }

  intelFeedItems(feedId: string, query: { limit?: number; offset?: number } = {}): Promise<CustomerIntelItemsResponse> {
    return this.req<CustomerIntelItemsResponse>('GET', `/intel/feeds/${feedId}/items`, { query });
  }

  upsertIntelFeedItems(feedId: string, items: unknown[]): Promise<unknown> {
    return this.req('POST', `/intel/feeds/${feedId}/items`, { body: { items } });
  }

  updateIntelFeedItem(feedId: string, itemId: string, item: unknown): Promise<unknown> {
    return this.req('PATCH', `/intel/feeds/${feedId}/items/${itemId}`, { body: item });
  }

  deleteIntelFeedItem(feedId: string, itemId: string): Promise<unknown> {
    return this.req('DELETE', `/intel/feeds/${feedId}/items/${itemId}`);
  }

  attachIntelSources(policyId: string, sourceIds: string[]): Promise<unknown> {
    return this.req('POST', `/policies/${policyId}/intel-sources`, {
      body: { source_ids: sourceIds },
    });
  }

  policyIntelSources(policyId: string): Promise<unknown> {
    return this.req('GET', `/policies/${policyId}/intel-sources`);
  }

  detachIntelSource(policyId: string, sourceId: string): Promise<unknown> {
    return this.req('DELETE', `/policies/${policyId}/intel-sources/${sourceId}`);
  }

  upgradeEndpoint(endpointId: string, targetVersion = 'latest'): Promise<unknown> {
    return this.req('POST', `/endpoints/${endpointId}/upgrade`, {
      body: { target_version: targetVersion },
    });
  }

  bulkUpgradeEndpoints(body: {
    endpoint_ids?: string[];
    platform?: string;
    target_version?: string;
    update_all_outdated?: boolean;
    all?: boolean;
    limit?: number;
  }): Promise<unknown> {
    return this.req('POST', '/endpoints/bulk-upgrade', { body });
  }

  checkinEndpoint(endpointId: string): Promise<unknown> {
    return this.req('POST', `/endpoints/${endpointId}/commands/checkin`, { body: {} });
  }
}
