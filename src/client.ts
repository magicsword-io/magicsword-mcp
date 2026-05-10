import { request as undiciRequest } from 'undici';
import type {
  AlertsResponse,
  ApiErrorBody,
  EndpointsResponse,
  EnrollmentTokenResponse,
  MeResponse,
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
    method: 'GET' | 'POST',
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

  mintEnrollmentToken(body: { ttl_seconds?: number } = {}): Promise<EnrollmentTokenResponse> {
    return this.req<EnrollmentTokenResponse>('POST', '/enrollment-tokens', { body });
  }
}
