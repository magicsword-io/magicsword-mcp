import { mkdirSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir, platform } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { configPath, DEFAULT_BASE_URL, isValidMagicSwordApiKey, type MagicSwordConfig } from './config.js';

interface ConfigureOptions {
  apiKey?: string;
  baseUrl?: string;
  nonInteractive?: boolean;
}

function parseArgs(args: string[]): ConfigureOptions {
  const opts: ConfigureOptions = {};
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--api-key' || a === '-k') opts.apiKey = args[++i];
    else if (a === '--base-url' || a === '-u') opts.baseUrl = args[++i];
    else if (a === '--non-interactive' || a === '-n') opts.nonInteractive = true;
  }
  return opts;
}

async function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  try {
    const answer = (await rl.question(`${question}${suffix}: `)).trim();
    return answer || defaultValue || '';
  } finally {
    rl.close();
  }
}

function claudeDesktopConfigPath(): string {
  // macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
  // Linux: ~/.config/Claude/claude_desktop_config.json
  // Windows: %APPDATA%\Claude\claude_desktop_config.json
  const os = platform();
  if (os === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (os === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  }
  return join(homedir(), '.config', 'Claude', 'claude_desktop_config.json');
}

function writeConfig(cfg: MagicSwordConfig): string {
  const target = configPath();
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(cfg, null, 2)}\n`, { encoding: 'utf8' });
  // Best-effort: on POSIX, restrict the file to the user since it contains a secret.
  if (platform() !== 'win32') {
    try {
      chmodSync(target, 0o600);
    } catch {
      // non-fatal
    }
  }
  return target;
}

function snippetForClaudeDesktop(): string {
  return JSON.stringify(
    {
      mcpServers: {
        magicsword: {
          command: 'magicsword-mcp',
        },
      },
    },
    null,
    2,
  );
}

export async function runConfigure(rawArgs: string[]): Promise<void> {
  const opts = parseArgs(rawArgs);

  let existingApiKey: string | undefined;
  let existingBaseUrl: string | undefined;
  try {
    const existing = JSON.parse(readFileSync(configPath(), 'utf8')) as Partial<MagicSwordConfig>;
    existingApiKey = existing.apiKey;
    existingBaseUrl = existing.baseUrl;
  } catch {
    // first-time configure — fine
  }

  let apiKey = opts.apiKey;
  let baseUrl = opts.baseUrl;

  if (!opts.nonInteractive) {
    if (!apiKey) {
      const suffix = existingApiKey ? ` (press Enter to keep current ${existingApiKey.slice(0, 8)}...)` : '';
      const answered = await prompt(`MagicSword API key${suffix}`);
      apiKey = answered.trim() || existingApiKey;
    }
    if (!baseUrl) {
      baseUrl = await prompt('Portal base URL', existingBaseUrl ?? DEFAULT_BASE_URL);
    }
  } else {
    apiKey = apiKey ?? existingApiKey;
    baseUrl = baseUrl ?? existingBaseUrl ?? DEFAULT_BASE_URL;
  }

  if (!isValidMagicSwordApiKey(apiKey)) {
    process.stderr.write(
      'A valid MagicSword API key (starting with msk_) is required.\n' +
        'Mint one in Magic Portal → Settings → API Keys.\n',
    );
    process.exit(2);
  }

  const cfg: MagicSwordConfig = { apiKey, baseUrl: baseUrl || DEFAULT_BASE_URL };
  const path = writeConfig(cfg);

  process.stdout.write(`\nWrote ${path} (mode 600)\n\n`);
  process.stdout.write('Add this block to your Claude Desktop config:\n');
  process.stdout.write(`  ${claudeDesktopConfigPath()}\n\n`);
  process.stdout.write(`${snippetForClaudeDesktop()}\n\n`);
  process.stdout.write(
    'Then restart Claude Desktop. The MCP server will appear as "magicsword" with 19 tools.\n',
  );
}
