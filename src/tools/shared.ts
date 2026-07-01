import type { z, ZodRawShape } from 'zod';
import { MagicSwordApiError, type MagicSwordClient } from '../client.js';

export interface ToolContext {
  client: MagicSwordClient;
}

export interface ToolResultContent {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ToolDefinition<Shape extends ZodRawShape> {
  name: string;
  title: string;
  description: string;
  inputSchema: Shape;
  handler: (
    args: { [K in keyof Shape]: z.infer<Shape[K]> },
    ctx: ToolContext,
  ) => Promise<ToolResultContent>;
}

export function defineTool<Shape extends ZodRawShape>(def: ToolDefinition<Shape>): ToolDefinition<Shape> {
  return def;
}

/** Format an API error in a way an LLM can relay to the user clearly. */
export function formatApiError(err: unknown): ToolResultContent {
  if (err instanceof MagicSwordApiError) {
    if (err.isPlanGate) {
      return textError(
        `This MagicSword org needs the Enterprise plan to use MCP. ` +
          `The portal returned: "${err.message}". ` +
          `Upgrade in the Magic Portal under Settings → Billing, then retry.`,
      );
    }
    if (err.isAuthFailure) {
      return textError(
        `MagicSword API key is missing, malformed, or revoked. ` +
          `Run \`magicsword-mcp configure\` to set a new key, then restart your MCP client. ` +
          `(Server said: "${err.message}".)`,
      );
    }
    if (err.isScopeFailure) {
      return textError(
        `MagicSword API key is missing the scope required for this action. ` +
          `Server said: "${err.message}". Mint a new key with the right scopes in Settings → API Keys.`,
      );
    }
    if (err.status === 503) {
      return textError(
        `MagicSword API is temporarily unavailable (${err.status}). ` +
          `This is usually transient — retry in a few seconds. (Server said: "${err.message}".)`,
      );
    }
    if (err.status === 404) {
      return textError(
        `MagicSword API returned not found. Check the id, org scope, and portal base URL. ` +
          `(Server said: "${err.message}".)`,
      );
    }
    return textError(`MagicSword API error (${err.status}): ${err.message}`);
  }
  if (err instanceof Error) {
    return textError(`Unexpected error: ${err.message}`);
  }
  return textError(`Unexpected error: ${String(err)}`);
}

export function textOk(text: string, structured?: Record<string, unknown>): ToolResultContent {
  const result: ToolResultContent = {
    content: [{ type: 'text', text }],
  };
  if (structured) result.structuredContent = structured;
  return result;
}

export function textError(text: string): ToolResultContent {
  return {
    content: [{ type: 'text', text }],
    isError: true,
  };
}

/** Compile a glob like `prod-*-db?` into a RegExp anchored to the full string. Case-insensitive. */
export function globToRegex(glob: string): RegExp {
  let out = '^';
  for (const ch of glob) {
    if (ch === '*') out += '.*';
    else if (ch === '?') out += '.';
    else if ('\\^$.|+()[]{}'.includes(ch)) out += `\\${ch}`;
    else out += ch;
  }
  out += '$';
  return new RegExp(out, 'i');
}
