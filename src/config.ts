import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

export const DEFAULT_BASE_URL = 'https://www.magicsword.io';

export interface MagicSwordConfig {
  apiKey: string;
  baseUrl: string;
}

export function isValidMagicSwordApiKey(value: string | undefined): value is string {
  const trimmed = value?.trim();
  if (!trimmed?.startsWith('msk_')) return false;

  const suffix = trimmed.slice('msk_'.length).trim();
  return Boolean(suffix && suffix !== '...' && suffix !== '…' && !trimmed.includes('…'));
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
    const parsed = JSON.parse(raw) as Partial<MagicSwordConfig>;
    fileApiKey = parsed.apiKey;
    fileBaseUrl = parsed.baseUrl;
  } catch {
    // missing or unreadable — fine, env may still satisfy
  }

  const apiKey = envKey ?? fileApiKey;
  const baseUrl = envUrl ?? fileBaseUrl ?? DEFAULT_BASE_URL;

  if (!apiKey) {
    throw new Error(
      'No MagicSword API key found. Run `magicsword-mcp configure` or set MAGICSWORD_API_KEY.',
    );
  }
  if (!isValidMagicSwordApiKey(apiKey)) {
    throw new Error('MAGICSWORD_API_KEY must start with "msk_". Mint a key in Magic Portal → Settings → API Keys.');
  }
  return { apiKey, baseUrl };
}
