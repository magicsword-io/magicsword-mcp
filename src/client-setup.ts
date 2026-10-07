import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const CLIENTS = ['claude-desktop', 'codex', 'claude-code', 'cursor', 'manual'] as const;
export type SetupClient = typeof CLIENTS[number];
export interface ServerDefinition { command: string; args: string[]; env: Record<string, string> }

export function serverDefinition(credentialPath: string, baseUrl: string): ServerDefinition {
  return {
    command: process.execPath,
    args: [fileURLToPath(new URL('./index.js', import.meta.url))],
    env: { MAGICSWORD_CONFIG: resolve(credentialPath), MAGICSWORD_BASE_URL: baseUrl },
  };
}

export function clientConfigPath(client: SetupClient): string {
  if (client === 'cursor') return join(homedir(), '.cursor', 'mcp.json');
  if (client === 'codex') return join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'config.toml');
  if (client === 'claude-code') return process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : join(homedir(), '.claude.json');
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  if (platform() === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  return join(homedir(), '.config', 'Claude', 'claude_desktop_config.json');
}

export function atomicPrivateWrite(target: string, contents: string): void {
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    renameSync(temporary, target);
    if (platform() !== 'win32') chmodSync(target, 0o600);
  } finally { rmSync(temporary, { force: true }); }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function existingFile(target: string): string | undefined {
  if (!existsSync(target)) return undefined;
  if (!lstatSync(target).isFile()) throw new Error('Client configuration must be a regular file.');
  return readFileSync(target, 'utf8');
}

function backup(target: string, contents: string | undefined): void {
  if (contents !== undefined) atomicPrivateWrite(`${target}.magicsword-backup.${randomUUID()}`, contents);
}

export function registerClient(client: SetupClient, definition: ServerDefinition, customPath?: string): string | undefined {
  if (client === 'manual') return undefined;
  const target = customPath ? resolve(customPath) : clientConfigPath(client);
  const old = existingFile(target);
  let claudeConfig: Record<string, unknown> | undefined;
  if (client === 'claude-code' && old !== undefined) {
    let parsed: unknown;
    try { parsed = JSON.parse(old); } catch { throw new Error('Client configuration contains invalid JSON; no client settings were changed.'); }
    if (!object(parsed) || (parsed.mcpServers !== undefined && !object(parsed.mcpServers))) {
      throw new Error('Client configuration must contain an object with an optional mcpServers object.');
    }
    claudeConfig = parsed;
  }
  if (client === 'claude-desktop' || client === 'cursor') {
    let parsed: unknown;
    try { parsed = old === undefined ? {} : JSON.parse(old); }
    catch { throw new Error('Client configuration contains invalid JSON; no client settings were changed.'); }
    if (!object(parsed) || (parsed.mcpServers !== undefined && !object(parsed.mcpServers))) {
      throw new Error('Client configuration must contain an object with an optional mcpServers object.');
    }
    backup(target, old);
    atomicPrivateWrite(target, `${JSON.stringify({ ...parsed, mcpServers: { ...(parsed.mcpServers as object ?? {}), magicsword: definition } }, null, 2)}\n`);
    return target;
  }
  backup(target, old);
  const envArgs = Object.entries(definition.env).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
  const cli = client === 'codex' ? 'codex' : 'claude';
  const args = client === 'codex'
    ? ['mcp', 'add', 'magicsword', ...envArgs, '--', definition.command, ...definition.args]
    : ['mcp', 'add', '--scope', 'user', '--transport', 'stdio', 'magicsword', ...envArgs, '--', definition.command, ...definition.args];
  // Never forward CLI output: it can contain existing configuration or secrets.
  const result = spawnSync(cli, args, { encoding: 'utf8', timeout: 30_000, windowsHide: true, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) {
    if (old !== undefined) atomicPrivateWrite(target, old);
    else rmSync(target, { force: true });
    throw new Error(`Could not register with ${client}. Ensure its CLI is installed and the magicsword name is available, then retry. Existing client settings were restored.`);
  }
  if (client === 'claude-code' && claudeConfig) {
    // Preserve unrelated fields that the CLI may otherwise discard during migration.
    try {
      const updated: unknown = JSON.parse(readFileSync(target, 'utf8'));
      if (!object(updated) || !object(updated.mcpServers) || !object(updated.mcpServers.magicsword)) throw new Error('Invalid CLI registration.');
      atomicPrivateWrite(target, `${JSON.stringify({ ...updated, ...claudeConfig, mcpServers: { ...(claudeConfig.mcpServers as object ?? {}), magicsword: updated.mcpServers.magicsword } }, null, 2)}\n`);
    } catch {
      atomicPrivateWrite(target, old!);
      throw new Error('Could not verify Claude Code registration; existing client settings were restored.');
    }
  }
  return target;
}
