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

## Quick start

Requires **Node.js 22+**, an installed MCP client, and a MagicSword Enterprise
API key from **Magic Portal → Settings → API Keys**.

**Recommended: install and connect your client in one command.** Setup prompts
for your key privately and lets you choose Claude Desktop, Codex, Claude Code,
or Cursor:

```sh
npm install -g @magicsword-io/magicsword-mcp && magicsword-mcp configure
```

Already know your client? Run the matching one-liner:

| Client | Install and configure |
| --- | --- |
| Claude Desktop | `npm install -g @magicsword-io/magicsword-mcp && magicsword-mcp configure --client claude-desktop` |
| Cursor | `npm install -g @magicsword-io/magicsword-mcp && magicsword-mcp configure --client cursor` |
| Claude Code | `npm install -g @magicsword-io/magicsword-mcp && magicsword-mcp configure --client claude-code` |
| OpenAI Codex | `npm install -g @magicsword-io/magicsword-mcp && magicsword-mcp configure --client codex` |

Prefer your client's own registration command? After saving your key locally,
these also work without a global server install:

```sh
codex mcp add magicsword --env MAGICSWORD_BASE_URL=https://www.magicsword.io -- npx -y @magicsword-io/magicsword-mcp
claude mcp add --scope user --transport stdio magicsword --env MAGICSWORD_BASE_URL=https://www.magicsword.io -- npx -y @magicsword-io/magicsword-mcp
```

These are also a fallback when automatic registration cannot launch a client's
CLI on Windows. Desktop launch still requires Node/npx to be available to that
client; the recommended setup uses absolute paths instead.

### Install buttons: Cursor and VS Code

**First save your API key locally** (once per machine):

```sh
npm install -g @magicsword-io/magicsword-mcp && magicsword-mcp configure --client manual
```

Then click your client's button and approve its installation prompt:

[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=magicsword&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBtYWdpY3N3b3JkLWlvL21hZ2ljc3dvcmQtbWNwIl0sImVudiI6eyJNQUdJQ1NXT1JEX0JBU0VfVVJMIjoiaHR0cHM6Ly93d3cubWFnaWNzd29yZC5pbyJ9fQ%3D%3D)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_MCP-0078d4?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=magicsword&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40magicsword-io%2Fmagicsword-mcp%22%5D%2C%22env%22%3A%7B%22MAGICSWORD_BASE_URL%22%3A%22https%3A%2F%2Fwww.magicsword.io%22%7D%7D)
[![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_MCP-24bfa5?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=magicsword&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40magicsword-io%2Fmagicsword-mcp%22%5D%2C%22env%22%3A%7B%22MAGICSWORD_BASE_URL%22%3A%22https%3A%2F%2Fwww.magicsword.io%22%7D%7D&quality=insiders)

These buttons register a local `npx` server pointing at production. They contain
no API key; the server reads `~/.magicsword/mcp.json`. They require `npx` on the
client's PATH. If a desktop app cannot find Node or npx, use the recommended
setup above for absolute launch paths, or copy the absolute `command` and
`args` printed by `configure --client manual` into its configuration.

### Manual JSON fallback

After saving your key above, merge this entry into Claude Desktop's
`claude_desktop_config.json` or Cursor's `~/.cursor/mcp.json`, preserving your
other servers:

```json
{
  "mcpServers": {
    "magicsword": {
      "command": "npx",
      "args": [
        "-y",
        "@magicsword-io/magicsword-mcp"
      ],
      "env": {
        "MAGICSWORD_BASE_URL": "https://www.magicsword.io"
      }
    }
  }
}
```

For **VS Code / Insiders**, run **MCP: Open User Configuration** and merge this
configuration (VS Code uses `servers`, not `mcpServers`):

```json
{
  "servers": {
    "magicsword": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@magicsword-io/magicsword-mcp"
      ],
      "env": {
        "MAGICSWORD_BASE_URL": "https://www.magicsword.io"
      }
    }
  }
}
```

Restart your client or start a new session, then ask it to call `whoami` and
`list_endpoints`. Both must succeed to verify authentication and read access.

The official MCP Registry identifier is
`io.github.magicsword-io/magicsword-mcp`. Client-specific details follow below.

## Configure

```sh
magicsword-mcp configure
```

Setup asks for an API key with hidden input (mint one in **Magic Portal →
Settings → API Keys**) and which client to connect: Claude Desktop, Codex,
Claude Code, Cursor, or manual configuration. It saves the key only in
`~/.magicsword/mcp.json` (mode 600). The Portal defaults to
`https://www.magicsword.io`, replacing any saved preview origin. A custom
origin requires an explicit `--base-url` option.

Setup registers the selected client at its standard user-level location,
preserves other servers and settings, and creates a private backup of existing
client configuration. It updates an existing `magicsword` entry for JSON clients
and Codex. Claude Code requires that name to be available; use its own MCP
commands to remove an old registration before retrying. Codex and Claude Code
registration require their respective CLIs to be installed.

To choose a client directly, or reuse a saved key without prompting:

```sh
magicsword-mcp configure --client codex
magicsword-mcp configure --non-interactive --client claude-desktop
magicsword-mcp configure --client cursor --client-config /path/to/mcp.json
```

The launch entry uses absolute Node and installed server paths so desktop apps
can start it without inheriting your terminal's PATH. Re-run setup if you move
your Node installation or install the package under a different Node version.
Manual setup prints a credential-free launch entry for other local stdio MCP
clients. Unattended setup without `--client` writes only the MagicSword file.

Restart the selected client or start a new session to load `magicsword` and its
21 tools. Ask it to call `whoami` and then `list_endpoints` to verify access;
discovery alone does not verify API-key scopes. Claude Desktop logs are at
`~/Library/Logs/Claude/mcp*.log` on macOS. Browser-only clients require a remote
MCP transport; this package provides a local stdio server.

If you need a per-client override instead of `~/.magicsword/mcp.json`, set
`MAGICSWORD_API_KEY` and optionally `MAGICSWORD_BASE_URL` in that MCP host's
environment. Keep API keys out of shared config snippets and screenshots.

## Tools

| Tool                          | What it does                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `whoami`                      | Returns organization, key id, and scopes. Always call first when troubleshooting.                                             |
| `list_endpoints`              | Lists endpoints with optional platform / status / hostname-glob filtering.                                                     |
| `show_endpoint`               | Fetches one endpoint with OS, policy, compliance, upgrade, heartbeat, and AMSI details.                                        |
| `list_agent_releases`         | Lists available agent versions and per-platform latest releases.                                                               |
| `find_alerts`                 | Searches alerts by severity / ack state / since / hostname / MITRE technique.                                                  |
| `list_events`                 | Lists audit/block telemetry events, including last-day event review workflows.                                                 |
| `triage_alert`                | Fetches one alert directly with triggering events, metadata, and file context; optionally acknowledges or dismisses it.        |
| `list_policies`               | Lists policies with current version + mode.                                                                                    |
| `show_policy`                 | Shows one policy by id.                                                                                                        |
| `manage_policy_rules`         | Lists rules or adds explicit / event-derived rules to a policy by id or name. Avoid explicit flat hash rules for Windows WDAC. |
| `apply_policy_to_endpoints`   | Resolves endpoints and previews a policy assignment; `confirm=true` applies it after approval.                                |
| `flip_to_enforcing`           | Two-step preview/confirm flip with a server-issued one-time confirm token. Safety-critical.                                    |
| `list_customer_intel_feeds`   | Lists private intel feeds or feed items.                                                                                       |
| `manage_customer_intel_feed`  | Creates or updates feeds; deletion requires a preview followed by `confirm=true`.                                              |
| `manage_customer_intel_item`  | Edits feed items; deletion requires a preview followed by `confirm=true`.                                                      |
| `upsert_customer_intel_items` | Adds indicators extracted from reports into a private feed.                                                                    |
| `manage_policy_intel_sources` | Lists, attaches, or detaches intel feeds on a policy.                                                                          |
| `upgrade_endpoints`           | Previews upgrades for an endpoint selection; `confirm=true` queues them after approval.                                        |
| `request_endpoint_checkin`    | Queues an endpoint check-in command.                                                                                           |
| `mint_enrollment_token`       | Mints a one-time agent enrollment token.                                                                                       |
| `agent_install_instructions`  | Returns the install one-liner for macOS / Linux / Windows. No API call.                                                        |

Write tools require matching Customer API scopes in Magic Portal, such as
`alerts:write`, `policies:write`, `endpoints:write`, or `intel:write`.
Event review uses `alerts:read`; turning selected events into policy rules
uses `policies:write`.

Tools publish standard MCP safety annotations. Read-only discovery tools are
marked read-only and idempotent; enforcement, deletion, policy assignment,
rule changes, and agent upgrades are marked destructive so MCP clients can
apply appropriate confirmation UX.

## Adding and listing policy rules

`manage_policy_rules` accepts **one** input source per add: `rules` for explicit
rules, or `event_ids` for rules derived from telemetry. Each accepts 1–100 items.
Use `policy_id`, or `policy_name` with an optional `platform` to resolve a name.
The policy must already exist; ambiguous names require an ID or platform.

For example, to block the filenames from issue #5 on a Windows blocklist policy:

```json
{
  "action": "add",
  "policy_name": "Workstations",
  "platform": "windows",
  "rules": [
    { "type": "filename", "value": "rustdesk.exe", "status": "blocked" },
    { "type": "filename", "value": "mshta.exe", "status": "blocked" },
    { "type": "filename", "value": "wscript.exe", "status": "blocked" }
  ]
}
```

Explicit rules use `type` and `value`, with optional `status` (defaults to
`blocked`). Unknown rule fields are rejected; `rule_type` / `file_name` are not
substitutes. Filename and path values must be non-empty strings or supported
value objects. Publisher values require `publisherName` (or `publisher`) and a
valid `tbsHash` (or `tbs_hash` / `certificate_thumbprint`). Optional rule metadata
includes `name`, `mode`, version bounds, signer/file-attribute references,
`package_version`, and `target_platforms`. The Portal validates whether a rule
can be enforced on the resolved policy's platform. Flat Windows WDAC hashes
remain unsupported; use telemetry-derived rules or private intelligence feeds.

For telemetry, use `event_ids` with top-level `status` (defaults to `allowed`)
and an optional `type` override. Top-level `status` and `type` cannot be used
with explicit `rules`; set those fields on each rule instead.

Adds preserve existing rules and intelligence-source links. Matching customer
rules with a different status are updated; rules already at the requested status
are reported as unchanged duplicates. Feed-owned rules retain their provenance;
unsupported conflicts with a feed rule return an API error. The tool reports
the Portal's actual `added_count`, `updated_count`, and `duplicate_count`, and retains its version
information in structured output. An unchanged duplicate batch reports “No
changes needed.” Unexplained zero changes or malformed responses are errors:
inspect the current rules/version before retrying because the request may have
created a version. Writes are never retried automatically.
For event-derived batches, a count total smaller than the number of unique
requested events is also an error: some events may not have produced rules.
Successful changes and version details remain available in structured output.

To verify the current version's stored rules:

```json
{ "action": "list", "policy_id": "<policy UUID>", "limit": 500, "offset": 0 }
```

List requires an ID and `policies:read`. It returns stored customer rules and
materialized feed rules for the current version, with `total`, `limit`, and
`offset`. The default page size is 100, maximum 500; increase `offset` until all
`total` rows have been read. An empty page does not describe other versions or
indicators that have not been materialized into this version.

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
        → 31 events. Here are the file paths, publishers, and hashes.

User:   Allow the first 5 on the Workstations policy.
Claude: [calls manage_policy_rules action=add policy_name=Workstations event_ids=[...] status=allowed]
        → Created a new policy version with 5 allowed rules.
```

## Configuration sources, in order of precedence

1. `MAGICSWORD_API_KEY` / `MAGICSWORD_BASE_URL` env vars (set by the MCP host).
2. `~/.magicsword/mcp.json` (or `$MAGICSWORD_CONFIG`).
3. Default base URL `https://www.magicsword.io`.

Optional transport controls are `MAGICSWORD_REQUEST_TIMEOUT_MS` (default
30 seconds), `MAGICSWORD_RESPONSE_MAX_BYTES` (default 4 MiB), and
`MAGICSWORD_GET_RETRIES` (default 2, maximum 3). Only idempotent GET requests
are retried; write actions are never retried automatically.

## Safety notes

- **`flip_to_enforcing` is two-step.** The first call returns a server preview
  and one-time confirmation token; you must show the preview to a human and
  pass the token back to commit. Tokens are short-lived and single-use.
  This is **not MFA or server-verified human approval**: the same API key can
  perform both calls. The MCP host must obtain human approval before committing.
  A commit response must confirm success for the requested policy and identify
  its new version; otherwise use `show_policy` to verify the outcome before retrying.
  Success confirms the server policy version change. Endpoint enforcement takes
  effect through check-in; this response does not confirm endpoint delivery.
- **Intel attachments use enabled sources in batches of at most 60.** Capture
  requests share the API key creator's rate budget with the Portal UI. A 429
  response includes retry guidance; wait before submitting another batch.
  Attachment summaries report newly attached and already-attached counts
  separately. Invalid or incomplete counts require listing attachments before retrying.
- **Fleet changes and deletion are explicit.** Endpoint upgrades, policy
  assignments, and private-intel deletion return a no-op preview unless the
  approved follow-up call includes `confirm=true`.
- **Windows WDAC policy edits should not use explicit flat file hashes.**
  Use `manage_policy_rules` with `event_ids` when approving audit events so
  the Portal can derive supported path / publisher / filename rules, or use
  `upsert_customer_intel_items` for hash, AuthentiHash, page-hash, and TBS
  intelligence in a private feed.
- **Secrets stay on the user's machine.** The MCP server is a local stdio
  process; the API key is read from `~/.magicsword/mcp.json` (mode 600) or
  an env var passed by the MCP host. Nothing is sent off-machine except
  the requests to the configured `MAGICSWORD_BASE_URL`.
- **Remote Portal URLs must use HTTPS.** Plain HTTP is accepted only for
  localhost development. Configured URLs cannot contain credentials, paths,
  query strings, or fragments.

## Develop

```sh
npm install
npm run build
npm test
npm run test:package
npm run release:verify
node dist/index.js --version
```

Tests validate `--help`, `--version`, production-default migration, private client
registration, preservation and rollback, configure validation, secret redaction,
modern and legacy MCP startup, focused mutation confirmation, retry and timeout
semantics, response-size bounds, malformed responses, write non-retry behavior,
all 21 tools' HTTP contracts and confirmation flows over modern and legacy
stdio, explicit filename round trips, invalid rule shapes, ambiguous inputs,
actual mutation counts, and npm pack
contents. `test:package` installs a production-only tarball and
checks the installed CLI and MCP tool discovery; `release:verify` checks all
release metadata. See `docs/RELEASING.md` for npm and MCP Registry releases.

An opt-in live policy test is also available after `npm run build`:

```sh
MAGICSWORD_LIVE_TEST=1 MAGICSWORD_TEST_POLICY_ID="<disposable-policy-uuid>" node scripts/live-policy-rules.mjs
```

Use your private saved credentials or `MAGICSWORD_API_KEY`; do not put keys in
commands or shared logs. This test **writes policy versions** and requires a
disposable, unassigned Windows audit policy named with the prefix
`MCP issue 5 disposable verification`, seeded with more than 1,000 baseline rules
with at least one attached intelligence source, and no existing `rustdesk.exe`,
`mshta.exe`, or `wscript.exe` customer rules.
It verifies append behavior, pagination, intelligence-source preservation,
repeat adds, status updates, invalid inputs, and event-derived filenames when
suitable telemetry exists. It also exercises discovery and read tools through
stdio. It prints assertion names/counts only. Remove the disposable policy and
its versions after inspection; the test does not create or delete the fixture.
Set `MAGICSWORD_TEST_PROTOCOL=legacy` to exercise the legacy live transport.

With the same disposable policy and opt-in environment, run
`node scripts/live-demo-tools.mjs` to check assignment, upgrade, and enforcement
previews, all three platforms' installer instructions, and a disabled temporary
feed's create/update/upsert/list/item-delete/attach/detach/feed-delete flows.
The feed is removed in `finally`; the policy fixture still requires manual
cleanup. These checks never commit endpoint assignments, upgrades, or enforcement.
Actual endpoint commands, enrollment tokens, and alert acknowledgements/dismissals
are covered by the local HTTP fixtures.
