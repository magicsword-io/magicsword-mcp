import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { stdin, stdout } from 'node:process';
import { configPath, DEFAULT_BASE_URL, isValidMagicSwordApiKey, normalizeBaseUrl, type StoredMagicSwordConfig } from './config.js';
import { atomicPrivateWrite, CLIENTS, registerClient, serverDefinition, type SetupClient } from './client-setup.js';

interface ConfigureOptions {
  apiKey?: string;
  baseUrl?: string;
  nonInteractive?: boolean;
  client?: SetupClient;
  clientConfig?: string;
}

function parseArgs(args: string[]): ConfigureOptions {
  const opts: ConfigureOptions = {};
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--non-interactive' || a === '-n') { opts.nonInteractive = true; continue; }
    if (!['--api-key', '-k', '--base-url', '-u', '--client', '--client-config'].includes(a)) throw new Error('Unknown configure option. Run magicsword-mcp --help.');
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error('Configure option requires a value.');
    if (a === '--api-key' || a === '-k') opts.apiKey = value;
    else if (a === '--base-url' || a === '-u') opts.baseUrl = value;
    else if (a === '--client-config') opts.clientConfig = value;
    else {
      if (!(CLIENTS as readonly string[]).includes(value)) throw new Error(`Client must be one of: ${CLIENTS.join(', ')}.`);
      opts.client = value as SetupClient;
    }
  }
  if (opts.clientConfig && opts.client !== 'claude-desktop' && opts.client !== 'cursor') throw new Error('--client-config requires --client claude-desktop or cursor.');
  return opts;
}

async function prompt(question: string, hidden = false): Promise<string> {
  stdout.write(`${question}: `);
  const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const rl = createInterface({ input: stdin, output: hidden ? muted : stdout, terminal: Boolean(stdin.isTTY) });
  try {
    return (await new Promise<string>((resolve, reject) => {
      rl.once('SIGINT', () => { reject(new Error('Setup cancelled.')); rl.close(); });
      rl.once('close', () => reject(new Error('Setup cancelled.')));
      rl.question('').then(resolve, reject);
    })).trim();
  }
  finally { rl.close(); muted.destroy(); if (hidden) stdout.write('\n'); }
}

export async function runConfigure(rawArgs: string[]): Promise<void> {
  try {
    const opts = parseArgs(rawArgs);
    let existingApiKey: string | undefined;
    try {
      const existing = JSON.parse(readFileSync(configPath(), 'utf8')) as Partial<StoredMagicSwordConfig>;
      if (typeof existing?.apiKey === 'string') existingApiKey = existing.apiKey;
    } catch { /* Missing credentials can be supplied below. */ }

    let apiKey = opts.apiKey ?? process.env.MAGICSWORD_API_KEY;
    let client = opts.client;
    if (!opts.nonInteractive) {
      if (!apiKey) {
        if (!stdin.isTTY) throw new Error('Interactive setup requires a terminal. Use --non-interactive with MAGICSWORD_API_KEY instead.');
        apiKey = await prompt(`MagicSword API key (hidden${existingApiKey ? '; Enter keeps saved key' : ''})`, true) || existingApiKey;
      }
      if (!client) {
        stdout.write('\nWhere should MagicSword be connected?\n  1. Claude Desktop\n  2. Codex (app / CLI / IDE)\n  3. Claude Code\n  4. Cursor\n  5. Manual configuration\n');
        const choice = await prompt('Choose 1–5');
        const index = Number(choice) - 1;
        if (!Number.isInteger(index) || index < 0 || index >= CLIENTS.length) throw new Error('Choose a client from 1 to 5, or use --client.');
        client = CLIENTS[index];
      }
    } else apiKey ??= existingApiKey;

    if (!isValidMagicSwordApiKey(apiKey)) throw new Error('A valid MagicSword API key (starting with msk_) is required. Mint one in Magic Portal → Settings → API Keys.');
    const baseUrl = normalizeBaseUrl(opts.baseUrl ?? DEFAULT_BASE_URL);
    const path = configPath();
    const cfg: StoredMagicSwordConfig = { apiKey: apiKey.trim(), baseUrl };
    atomicPrivateWrite(path, `${JSON.stringify(cfg, null, 2)}\n`);
    stdout.write(`\nSaved private MagicSword credentials to ${path} (mode 600).\n`);
    if (!opts.baseUrl) stdout.write(`Portal: ${DEFAULT_BASE_URL}\n`);
    const definition = serverDefinition(path, baseUrl);
    const target = registerClient(client ?? 'manual', definition, opts.clientConfig);
    if (target) {
      stdout.write(`Registered magicsword with ${client} in ${target}.\nRestart the client or start a new session to load its 21 tools.\n`);
    } else {
      stdout.write('\nChoose --client claude-desktop, codex, claude-code, or cursor to register automatically.\nFor another local stdio MCP client, merge this entry into its configuration:\n');
      stdout.write(`${JSON.stringify({ mcpServers: { magicsword: definition } }, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Setup failed.'}\n`);
    process.exitCode = 2;
  }
}
