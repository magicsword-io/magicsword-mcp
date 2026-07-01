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

### From npm

```sh
npm install -g @magicsword-io/magicsword-mcp
```

Requires Node 22+. Homebrew, winget, and curl installer packaging should be
published after the npm package is released and checksums are available.

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

Restart Claude Desktop and "magicsword" will appear with 19 tools. Logs are
at `~/Library/Logs/Claude/mcp*.log` on macOS.

## Tools

| Tool | What it does |
| --- | --- |
| `whoami` | Returns org, plan, key id, scopes. Always call first when troubleshooting. |
| `list_endpoints` | Lists endpoints with optional platform / status / hostname-glob filtering. |
| `find_alerts` | Searches alerts by severity / ack state / since / hostname / MITRE technique. |
| `list_events` | Lists audit/block telemetry events, including last-day event review workflows. |
| `triage_alert` | Fetches one alert with process chain + evidence; optionally acknowledges or dismisses it. |
| `list_policies` | Lists policies with current version + mode. |
| `show_policy` | Shows one policy by id. |
| `manage_policy_rules` | Lists rules or adds explicit / event-derived rules to a policy by id or name. |
| `apply_policy_to_endpoints` | Resolves endpoints by id list or hostname-glob and assigns a policy. |
| `flip_to_enforcing` | Two-step preview/confirm flip with a server-issued one-time confirm token. Safety-critical. |
| `list_customer_intel_feeds` | Lists customer-owned intel feeds or feed items. |
| `manage_customer_intel_feed` | Creates, updates, or deletes customer-owned intel feeds. |
| `manage_customer_intel_item` | Edits or deletes one customer-owned intel feed item. |
| `upsert_customer_intel_items` | Adds indicators extracted from reports into a customer-owned feed. |
| `manage_policy_intel_sources` | Lists, attaches, or detaches intel feeds on a policy. |
| `upgrade_endpoints` | Queues agent upgrades for one endpoint, a selected list, a platform, or hostname-glob results. |
| `request_endpoint_checkin` | Queues an endpoint check-in command. |
| `mint_enrollment_token` | Mints a one-time agent enrollment token. |
| `agent_install_instructions` | Returns the install one-liner for macOS / Linux / Windows. No API call. |

Write tools require matching Customer API scopes in Magic Portal, such as
`alerts:write`, `policies:write`, `endpoints:write`, or `intel:write`.
Event review uses `alerts:read`; turning selected events into policy rules
uses `policies:write`.

## Example transcript

```
User:   Show me unack'd critical alerts from the last 24h.
Claude: [calls find_alerts severity=critical acknowledged=false since=...]
        → 3 critical alerts on 2 endpoints. Want me to triage the top one?

User:   Yes.
Claude: [calls triage_alert]
        → Evidence chain: cmd.exe spawned by winword.exe with -enc base64.
          MITRE T1059.001. Acknowledge with comment "office macro chain — under investigation"?

User:   Yes, and extract the IOCs from this report into our SOC feed.
Claude: [calls upsert_customer_intel_items]
        → Upserted 47 indicators into feed 8d6...

User:   Show me audited or blocked events from the last day.
Claude: [calls list_events hours=24 status=audited,blocked]
        → 31 events. Here are the file paths and hashes.

User:   Allow the first 5 on the Workstations policy.
Claude: [calls manage_policy_rules action=add policy_name=Workstations event_ids=[...] status=allowed]
        → Created a new policy version with 5 allowed rules.
```

## Configuration sources, in order of precedence

1. `MAGICSWORD_API_KEY` / `MAGICSWORD_BASE_URL` env vars (set by the MCP host).
2. `~/.magicsword/mcp.json` (or `$MAGICSWORD_CONFIG`).
3. Default base URL `https://app.magicsword.io`.

## Safety notes

- **`flip_to_enforcing` is two-step.** The first call returns a server preview
  and one-time confirmation token; you must show the preview to a human and
  pass the token back to commit. Tokens are short-lived and single-use.
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
