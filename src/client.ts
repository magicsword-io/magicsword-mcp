import { request as undiciRequest } from 'undici';
import type {
  AgentReleasesResponse,
  AlertDetailResponse,
  AlertsResponse,
  ApiErrorBody,
  CustomerIntelFeedsResponse,
  CustomerIntelItemsResponse,
  EndpointDetailResponse,
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
  requestTimeoutMs?: number;
  responseMaxBytes?: number;
  getRetries?: number;
  retryBaseDelayMs?: number;
}

export class MagicSwordTransportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MagicSwordTransportError';
  }
}

export class MagicSwordApiError extends Error {
  status: number;
  feature?: string;
  body: unknown;
  url: string;

  constructor(status: number, body: unknown, url: string) {
    const parsed = body && typeof body === 'object' ? (body as ApiErrorBody) : null;
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
  private readonly requestTimeoutMs: number;
  private readonly responseMaxBytes: number;
  private readonly getRetries: number;
  private readonly retryBaseDelayMs: number;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.userAgent = config.userAgent ?? 'magicsword-mcp/0.1';
    this.requestTimeoutMs = config.requestTimeoutMs ?? 30_000;
    this.responseMaxBytes = config.responseMaxBytes ?? 4 * 1024 * 1024;
    this.getRetries = config.getRetries ?? 2;
    this.retryBaseDelayMs = config.retryBaseDelayMs ?? 250;
  }

  private async readResponseBody(
    body: AsyncIterable<Uint8Array> & { destroy?: (error?: Error) => void },
  ): Promise<string> {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of body) {
      const buffer = Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > this.responseMaxBytes) {
        const error = new MagicSwordTransportError(
          `MagicSword API response exceeded the configured ${this.responseMaxBytes}-byte limit.`,
        );
        body.destroy?.(error);
        throw error;
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, totalBytes).toString('utf8');
  }

  private retryDelayMs(attempt: number, retryAfter: string | string[] | undefined): number {
    const header = Array.isArray(retryAfter) ? retryAfter[0] : retryAfter;
    if (header) {
      const seconds = Number(header);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 30_000);
      const retryAt = Date.parse(header);
      if (Number.isFinite(retryAt)) return Math.min(Math.max(retryAt - Date.now(), 0), 30_000);
    }
    return Math.min(this.retryBaseDelayMs * 2 ** attempt, 5_000);
  }

  private async wait(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private static pathId(value: string): string {
    return encodeURIComponent(value);
  }

  private async req<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    options: {
      query?: Record<string, string | number | boolean | undefined>;
      body?: unknown;
    } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/public/v1${path}`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value === undefined || value === null || value === '') continue;
        url.searchParams.set(key, String(value));
      }
    }

    const maxAttempts = method === 'GET' ? this.getRetries + 1 : 1;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const response = await undiciRequest(url, {
          method,
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            accept: 'application/json',
            'user-agent': this.userAgent,
            ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
          },
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          bodyTimeout: this.requestTimeoutMs,
          headersTimeout: this.requestTimeoutMs,
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });

        const text = await this.readResponseBody(response.body);
        let parsed: unknown = undefined;
        let parsedJson = text.length === 0;
        if (text.length > 0) {
          try {
            parsed = JSON.parse(text);
            parsedJson = true;
          } catch {
            parsed = { error: text };
          }
        }

        const retryableStatus = [429, 502, 503, 504].includes(response.statusCode);
        if (retryableStatus && attempt + 1 < maxAttempts) {
          await this.wait(this.retryDelayMs(attempt, response.headers['retry-after']));
          continue;
        }
        if (response.statusCode >= 400) {
          throw new MagicSwordApiError(response.statusCode, parsed, url.toString());
        }

        const contentType = response.headers['content-type'];
        const normalizedContentType = Array.isArray(contentType) ? contentType[0] : contentType;
        const isJsonContentType = normalizedContentType
          ? /(?:application\/json|\+json)(?:\s*;|$)/i.test(normalizedContentType)
          : false;
        if (text.length > 0 && (!isJsonContentType || !parsedJson)) {
          throw new MagicSwordTransportError('MagicSword API returned an invalid JSON success response.');
        }
        return parsed as T;
      } catch (error) {
        if (error instanceof MagicSwordApiError || error instanceof MagicSwordTransportError) throw error;
        if (attempt + 1 < maxAttempts) {
          await this.wait(this.retryDelayMs(attempt, undefined));
          continue;
        }
        throw new MagicSwordTransportError(
          `MagicSword API request failed after ${maxAttempts} attempt${maxAttempts === 1 ? '' : 's'}.`,
          { cause: error },
        );
      }
    }
    throw new MagicSwordTransportError('MagicSword API request failed unexpectedly.');
  }

  me(): Promise<MeResponse> {
    return this.req<MeResponse>('GET', '/me');
  }

  policies(query: { platform?: string } = {}): Promise<PoliciesResponse> {
    return this.req<PoliciesResponse>('GET', '/policies', { query });
  }

  policy(policyId: string): Promise<PolicyDetailResponse> {
    return this.req<PolicyDetailResponse>('GET', `/policies/${MagicSwordClient.pathId(policyId)}`);
  }

  policyRules(policyId: string, query: { limit?: number; offset?: number } = {}): Promise<unknown> {
    return this.req('GET', `/policies/${MagicSwordClient.pathId(policyId)}/rules`, { query });
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
      return this.req('POST', `/policies/${MagicSwordClient.pathId(body.policy_id)}/rules`, { body });
    }
    return this.req('POST', '/policies/rules', { body });
  }

  enforcePreview(policyId: string, acknowledgeBlockers = false): Promise<unknown> {
    return this.req('POST', `/policies/${MagicSwordClient.pathId(policyId)}/enforce-preview`, {
      body: { acknowledge_blockers: acknowledgeBlockers },
    });
  }

  enforcePolicy(policyId: string, confirmationToken: string): Promise<unknown> {
    return this.req('POST', `/policies/${MagicSwordClient.pathId(policyId)}/enforce`, {
      body: { confirmation_token: confirmationToken },
    });
  }

  alerts(
    query: {
      severity?: string;
      acknowledged?: boolean;
      since?: string;
      hostname_pattern?: string;
      mitre_technique?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<AlertsResponse> {
    return this.req<AlertsResponse>('GET', '/alerts', {
      query: {
        severity: query.severity,
        acknowledged: query.acknowledged === undefined ? undefined : String(query.acknowledged),
        since: query.since,
        hostname_pattern: query.hostname_pattern,
        mitre_technique: query.mitre_technique,
        limit: query.limit,
        offset: query.offset,
      },
    });
  }

  alert(alertId: string): Promise<AlertDetailResponse> {
    return this.req<AlertDetailResponse>('GET', `/alerts/${MagicSwordClient.pathId(alertId)}`);
  }

  endpoints(
    query: {
      platform?: string;
      status?: string;
      hostname_pattern?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<EndpointsResponse> {
    return this.req<EndpointsResponse>('GET', '/endpoints', { query });
  }

  endpoint(endpointId: string): Promise<EndpointDetailResponse> {
    return this.req<EndpointDetailResponse>('GET', `/endpoints/${MagicSwordClient.pathId(endpointId)}`);
  }

  agentReleases(query: { platform?: string; latest?: boolean } = {}): Promise<AgentReleasesResponse> {
    return this.req<AgentReleasesResponse>('GET', '/agent-releases', { query });
  }

  events(
    query: {
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
    } = {},
  ): Promise<EventsResponse> {
    return this.req<EventsResponse>('GET', '/events', { query });
  }

  mintEnrollmentToken(body: { ttl_seconds?: number } = {}): Promise<EnrollmentTokenResponse> {
    return this.req<EnrollmentTokenResponse>('POST', '/enrollment-tokens', {
      body,
    });
  }

  assignPolicyToEndpoints(policyId: string, endpointIds: string[]): Promise<unknown> {
    return this.req('POST', `/policies/${MagicSwordClient.pathId(policyId)}/assign-endpoints`, {
      body: { endpoint_ids: endpointIds },
    });
  }

  acknowledgeAlert(alertId: string, comment?: string): Promise<unknown> {
    return this.req('POST', `/alerts/${MagicSwordClient.pathId(alertId)}/acknowledge`, {
      body: comment ? { comment } : {},
    });
  }

  dismissAlert(alertId: string, reason?: string): Promise<unknown> {
    return this.req('POST', `/alerts/${MagicSwordClient.pathId(alertId)}/dismiss`, {
      body: reason ? { reason } : {},
    });
  }

  intelFeeds(query: { limit?: number; offset?: number } = {}): Promise<CustomerIntelFeedsResponse> {
    return this.req<CustomerIntelFeedsResponse>('GET', '/intel/feeds', {
      query,
    });
  }

  createIntelFeed(body: {
    name: string;
    description?: string;
    platforms?: string[];
    is_enabled?: boolean;
  }): Promise<{ feed: unknown }> {
    return this.req('POST', '/intel/feeds', { body });
  }

  updateIntelFeed(
    feedId: string,
    body: {
      name?: string;
      description?: string;
      platforms?: string[];
      is_enabled?: boolean;
    },
  ): Promise<{ feed: unknown }> {
    return this.req('PATCH', `/intel/feeds/${MagicSwordClient.pathId(feedId)}`, { body });
  }

  deleteIntelFeed(feedId: string): Promise<unknown> {
    return this.req('DELETE', `/intel/feeds/${MagicSwordClient.pathId(feedId)}`);
  }

  intelFeedItems(feedId: string, query: { limit?: number; offset?: number } = {}): Promise<CustomerIntelItemsResponse> {
    return this.req<CustomerIntelItemsResponse>('GET', `/intel/feeds/${MagicSwordClient.pathId(feedId)}/items`, {
      query,
    });
  }

  upsertIntelFeedItems(feedId: string, items: unknown[]): Promise<unknown> {
    return this.req('POST', `/intel/feeds/${MagicSwordClient.pathId(feedId)}/items`, { body: { items } });
  }

  updateIntelFeedItem(feedId: string, itemId: string, item: unknown): Promise<unknown> {
    return this.req(
      'PATCH',
      `/intel/feeds/${MagicSwordClient.pathId(feedId)}/items/${MagicSwordClient.pathId(itemId)}`,
      { body: item },
    );
  }

  deleteIntelFeedItem(feedId: string, itemId: string): Promise<unknown> {
    return this.req(
      'DELETE',
      `/intel/feeds/${MagicSwordClient.pathId(feedId)}/items/${MagicSwordClient.pathId(itemId)}`,
    );
  }

  attachIntelSources(policyId: string, sourceIds: string[]): Promise<unknown> {
    return this.req('POST', `/policies/${MagicSwordClient.pathId(policyId)}/intel-sources`, {
      body: { source_ids: sourceIds },
    });
  }

  policyIntelSources(policyId: string): Promise<unknown> {
    return this.req('GET', `/policies/${MagicSwordClient.pathId(policyId)}/intel-sources`);
  }

  detachIntelSource(policyId: string, sourceId: string): Promise<unknown> {
    return this.req(
      'DELETE',
      `/policies/${MagicSwordClient.pathId(policyId)}/intel-sources/${MagicSwordClient.pathId(sourceId)}`,
    );
  }

  upgradeEndpoint(endpointId: string, targetVersion = 'latest'): Promise<unknown> {
    return this.req('POST', `/endpoints/${MagicSwordClient.pathId(endpointId)}/upgrade`, {
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
    return this.req('POST', `/endpoints/${MagicSwordClient.pathId(endpointId)}/commands/checkin`, { body: {} });
  }
}
