# magicsword-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server for
[MagicSword](https://magicsword.io). Lets users running Claude Desktop,
Cursor, or any MCP-aware client manage MagicSword conversationally — list
endpoints, query alerts, triage findings, mint enrollment tokens, and
preview / commit policy changes.

The server is a thin, opinionated wrapper around the
`/api/public/v1/*` customer API exposed by the Magic Portal. It runs on
the user's machine, holds an `msk_…` API key, and speaks MCP over stdio.

> **Plan gate.** The customer API is Enterprise-only. With a pilot-tier key
> the server returns a clear "this MagicSword org needs the Enterprise plan
> to use MCP" message; nothing else works until the org is upgraded.

## Install

### macOS — Homebrew (recommended)

```sh
brew install magicsword-io/magicsword/magicsword-mcp
```

### Linux — curl-pipe

```sh
curl -fsSL https://get.magicsword.io/mcp.sh | sh
```

(Requires Node 22+. The script `npm install -g @magicsword-io/magicsword-mcp`.)

### Windows — winget

```powershell
winget install MagicSword.MCP
```

### From npm directly

```sh
npm install -g @magicsword-io/magicsword-mcp
```

## Configure

```sh
magicsword-mcp configure
```

You'll be prompted for an API key (mint one in **Magic Portal → Settings →
API Keys**) and a portal base URL (defaults to `https://app.magicsword.io`).
The command writes `~/.magicsword/mcp.json` (mode 600) and prints the exact
JSON snippet to paste into Claude Desktop's config:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

The snippet looks like this:

```json
{
  "mcpServers": {
    "magicsword": {
      "command": "magicsword-mcp",
      "env": {
        "MAGICSWORD_API_KEY": "msk_...",
        "MAGICSWORD_BASE_URL": "https://app.magicsword.io"
      }
    }
  }
}
```

Restart Claude Desktop and "magicsword" will appear with 10 tools. Logs are
at `~/Library/Logs/Claude/mcp*.log` on macOS.

## Tools

| Tool | What it does |
| --- | --- |
| `whoami` | Returns org, plan, key id, scopes. Always call first when troubleshooting. |
| `list_endpoints` | Lists endpoints with optional platform / status / hostname-glob filtering. |
| `find_alerts` | Searches alerts by severity / ack state / since / hostname / MITRE technique. |
| `triage_alert` | Fetches one alert with process chain + evidence; optional ack (write API ships separately). |
| `list_policies` | Lists policies with current version + mode. |
| `show_policy` | Shows one policy by id. |
| `apply_policy_to_endpoints` | Resolves endpoints by id list or hostname-glob; previews assignment until the write API ships. |
| `flip_to_enforcing` | Two-step preview/confirm flip with a server-issued one-time confirm token. Safety-critical. |
| `mint_enrollment_token` | Mints a one-time agent enrollment token. |
| `agent_install_instructions` | Returns the install one-liner for macOS / Linux / Windows. No API call. |

The MCP server itself does **not** ship the public-API write side; that
lands incrementally in `magicsword-io/magic-portal`. Tools that need write
endpoints surface a clear "coming soon" notice rather than reaching into a
different (internal) auth surface.

## Example transcript

```
User:   Show me unack'd critical alerts from the last 24h.
Claude: [calls find_alerts severity=critical acknowledged=false since=...]
        → 3 critical alerts on 2 endpoints. Want me to triage the top one?

User:   Yes.
Claude: [calls triage_alert]
        → Evidence chain: cmd.exe spawned by winword.exe with -enc base64.
          MITRE T1059.001. Acknowledge with comment "office macro chain — under investigation"?

User:   Yes, and apply the workstation-standard policy in audit mode to that endpoint's fleet.
Claude: [calls flip_to_enforcing]
        → 12 endpoints affected, 0 blocks expected. Confirm to proceed.
```

## Configuration sources, in order of precedence

1. `MAGICSWORD_API_KEY` / `MAGICSWORD_BASE_URL` env vars (set by the MCP host).
2. `~/.magicsword/mcp.json` (or `$MAGICSWORD_CONFIG`).
3. Default base URL `https://app.magicsword.io`.

## Safety notes

- **`flip_to_enforcing` is two-step.** The first call returns a preview + a
  one-time `confirm_token`; you must show the preview to a human and pass
  the token back to commit. Tokens are 5-minute single-use. This is
  enforced today even though the underlying write API ships later, so
  behaviour is correct the moment the route lands.
- **Secrets stay on the user's machine.** The MCP server is a local stdio
  process; the API key is read from `~/.magicsword/mcp.json` (mode 600) or
  an env var passed by the MCP host. Nothing is sent off-machine except
  the requests to the configured `MAGICSWORD_BASE_URL`.

## Develop

```sh
npm install
npm run build
node dist/index.js --version
```

Tests can be added under `__tests__/` (none yet — first PR ships
infrastructure + tools).

## Related

- Customer API + key UI: `magicsword-io/magic-portal#822`.
- Free-user / agent registration UX: `magicsword-io/magicsword-deployer#202`,
  `magicsword-io/magic-portal#823`.
