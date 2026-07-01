#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MagicSwordClient } from './client.js';
import { loadConfig } from './config.js';
import { runConfigure } from './configure.js';
import { allTools } from './tools/index.js';

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const VERSION = readPackageVersion();

function printVersion(): void {
  process.stdout.write(`magicsword-mcp ${VERSION}\n`);
}

function printHelp(): void {
  process.stdout.write(
    [
      'magicsword-mcp — MagicSword MCP server',
      '',
      'Usage:',
      '  magicsword-mcp                    Start the MCP server over stdio (for Claude Desktop, Cursor, etc.)',
      '  magicsword-mcp configure          Interactively write ~/.magicsword/mcp.json',
      '  magicsword-mcp --version          Print version',
      '  magicsword-mcp --help             Print this help',
      '',
      'Environment:',
      '  MAGICSWORD_API_KEY   API key (msk_...)  — overrides config file',
      '  MAGICSWORD_BASE_URL  Portal base URL    — defaults to https://www.magicsword.io',
      '  MAGICSWORD_CONFIG    Path to config json — defaults to ~/.magicsword/mcp.json',
      '',
    ].join('\n'),
  );
}

async function startServer(): Promise<void> {
  const config = loadConfig();
  const client = new MagicSwordClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    userAgent: `magicsword-mcp/${VERSION}`,
  });

  const server = new McpServer(
    { name: 'magicsword-mcp', version: VERSION },
    {
      instructions:
        'MagicSword MCP exposes EDR management as conversational tools. Start with `whoami` to confirm the org/plan/scopes. ' +
        'Use `find_alerts` and `list_events` for triage, `list_endpoints` to scope a fleet, `upsert_customer_intel_items` to load report IOCs, and `manage_policy_rules` to add approved rules. ' +
        'For Windows WDAC, do not create explicit flat file-hash policy rules; use event_ids so the Portal can derive supported rules, or use private intel feeds for hash/AuthentiHash/page-hash/TBS IOCs. ' +
        'Destructive operations (`flip_to_enforcing`) require a two-step preview/confirm; never call them without showing ' +
        'the preview to the human first.',
    },
  );

  for (const tool of allTools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args: Record<string, unknown>) => {
        const result = await tool.handler(args as never, { client });
        return result;
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Stay alive on SIGTERM/SIGINT so the host can request graceful shutdown.
  const shutdown = async (signal: string): Promise<void> => {
    process.stderr.write(`magicsword-mcp: received ${signal}, shutting down\n`);
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

async function main(): Promise<void> {
  const [, , subcommand, ...rest] = process.argv;

  if (subcommand === 'configure') {
    await runConfigure(rest);
    return;
  }
  if (subcommand === '--version' || subcommand === '-v') {
    printVersion();
    return;
  }
  if (subcommand === '--help' || subcommand === '-h') {
    printHelp();
    return;
  }
  if (subcommand && subcommand !== 'serve') {
    process.stderr.write(`Unknown subcommand: ${subcommand}\n\n`);
    printHelp();
    process.exit(2);
  }

  try {
    await startServer();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`magicsword-mcp failed to start: ${message}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
