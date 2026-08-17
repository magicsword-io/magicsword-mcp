import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

export const DEFAULT_BASE_URL = 'https://www.magicsword.io';

export interface MagicSwordConfig {
  apiKey: string;
  baseUrl: string;
  requestTimeoutMs: number;
  responseMaxBytes: number;
  getRetries: number;
}

export type StoredMagicSwordConfig = Pick<MagicSwordConfig, 'apiKey' | 'baseUrl'>;

export function isValidMagicSwordApiKey(value: string | undefined): value is string {
  const trimmed = value?.trim();
  return Boolean(trimmed && /^msk_[A-Za-z0-9_-]{16,256}$/.test(trimmed));
}

export function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('MAGICSWORD_BASE_URL must be a valid absolute URL.');
  }

  const isLocalhost =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost)) {
    throw new Error('MAGICSWORD_BASE_URL must use HTTPS (HTTP is allowed only for localhost).');
  }
  if (url.username || url.password) {
    throw new Error('MAGICSWORD_BASE_URL must not contain credentials.');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('MAGICSWORD_BASE_URL must be an origin without a path, query, or fragment.');
  }
  return url.origin;
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

export function configPath(): string {
  return process.env.MAGICSWORD_CONFIG ?? join(homedir(), '.magicsword', 'mcp.json');
}

/**
 * Load configuration from (in order): env vars, then ~/.magicsword/mcp.json.
 * Env vars beat the file so MCP clients can pin a key per-server.
 */
export function loadConfig(): MagicSwordConfig {
  const envKey = process.env.MAGICSWORD_API_KEY;
  const envUrl = process.env.MAGICSWORD_BASE_URL;

  let fileApiKey: string | undefined;
  let fileBaseUrl: string | undefined;
  try {
    const raw = readFileSync(configPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoredMagicSwordConfig>;
    fileApiKey = parsed.apiKey;
    fileBaseUrl = parsed.baseUrl;
  } catch {
    // missing or unreadable — fine, env may still satisfy
  }

  const apiKey = (envKey ?? fileApiKey)?.trim();
  const baseUrl = normalizeBaseUrl(envUrl ?? fileBaseUrl ?? DEFAULT_BASE_URL);

  if (!apiKey) {
    throw new Error('No MagicSword API key found. Run `magicsword-mcp configure` or set MAGICSWORD_API_KEY.');
  }
  if (!isValidMagicSwordApiKey(apiKey)) {
    throw new Error('MAGICSWORD_API_KEY is malformed. Mint a key in Magic Portal → Settings → API Keys.');
  }
  return {
    apiKey,
    baseUrl,
    requestTimeoutMs: envInt('MAGICSWORD_REQUEST_TIMEOUT_MS', 30_000, 1_000, 120_000),
    responseMaxBytes: envInt('MAGICSWORD_RESPONSE_MAX_BYTES', 4 * 1024 * 1024, 64 * 1024, 16 * 1024 * 1024),
    getRetries: envInt('MAGICSWORD_GET_RETRIES', 2, 0, 3),
  };
}
