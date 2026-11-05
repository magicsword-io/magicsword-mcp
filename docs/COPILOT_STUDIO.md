# Microsoft Copilot Studio

MagicSword's portal implements a hosted MCP connector using Streamable HTTP,
OAuth discovery and dynamic client registration (DCR). Copilot Studio documents
these connection options. The local npm server speaks stdio; it does not expose
a public HTTP listener, and no `configure --client copilot-studio` command is
needed for this cloud connection.

## Connect an agent

1. Open the MCP setup guide in your MagicSword portal, under Settings → API
   Keys or at `/mcp`. Copy the hosted connector URL shown there. If it is not
   shown, ask your administrator to enable hosted access after completing the
   portal's hosted launch checks. Do not substitute the customer REST API URL,
   an SSE endpoint, localhost, or the npm install command.
2. Open your agent in Copilot Studio. Select Tools → Add a tool → New tool →
   Model Context Protocol.
3. Enter these server details:

   | Field | Value |
   | --- | --- |
   | Server name | MagicSword |
   | Server description | Investigate MagicSword endpoints, alerts, policies, and intelligence using the permissions you approve. |
   | Server URL | The exact hosted connector URL copied from your portal |
   | Authentication | OAuth 2.0 |
   | OAuth type | Dynamic discovery |

4. Select Create and Next, then Create a new connection. Sign in to MagicSword,
   choose your organization and start with read permissions. Select Add to agent.
   Each user should create their own connection with their own account.
5. In the added tool's Authentication settings, select **User authentication
   (End user credentials)**. Use a channel that supports user authentication.
   Agent author / maker-provided authentication would run calls with the author's
   grant; it does not establish per-user access. If the tenant/channel cannot
   support per-user connections, do not publish this agent for shared use.
6. Ask the agent to call `whoami`, then `list_endpoints`. Check that both succeed
   and that the organization and approved permissions match your selection.
   Tool discovery alone does not verify access. Ask for explicit approval before
   any mutation; additional workflows need their corresponding write scopes.

The onboarding wizard is the recommended route. No OpenAPI file or Power Apps
custom connector import is required for it. Catalog or Microsoft 365 deployment
is a separate distribution process.

## Authentication and availability

The portal publishes its authorization-server discovery and protected-resource
metadata and registers OAuth clients dynamically. It requires authorization-code
PKCE with S256 and supports refresh tokens. Its OAuth scope is `mcp`; actual
customer API permissions are selected during MagicSword consent. Copilot Studio
must complete that protocol without weakening these checks.

Do not choose None or API key for this hosted connector. A Settings `msk_` key,
Supabase session token, enrollment token, or refresh token is not a hosted MCP
access token. Do not put credentials in URLs, descriptions, prompts, or shared
configuration. An administrator must enable the hosted connector in that portal
environment; publishing the npm package does not enable it.

Power Platform data policies apply to MCP connectors. If the tool is blocked,
check the environment's connector policy with its administrator. If discovery
or sign-in fails, check the exact configured HTTPS origin, discovery responses,
registered callback and PKCE exchange using synthetic identities. Do not bypass
OAuth or grant broader scopes to make a connection succeed.

## Native verification before release

Use a staging portal and synthetic organization. Record pass/fail outcomes
without credentials or customer responses:

- Create the MCP tool using OAuth dynamic discovery; complete sign-in and consent.
- Confirm User authentication / End user credentials is selected and works in
  the intended channel. A second user must connect independently; the maker's
  successful test connection does not establish this.
- Verify `whoami` and `list_endpoints` return the selected organization and read access.
- Confirm write-only tools are hidden for read grants and unapproved writes fail.
- Verify an expired access token refreshes and the same connection remains usable.
- Disconnect in MagicSword's connected-assistants settings and confirm later
  tool calls and refresh attempts fail. Reconnecting must require fresh consent.
- Confirm a second user or organization cannot access the first user's grant.

The repository's protocol fixtures are useful regression evidence, but they do
not establish native Copilot Studio compatibility. No tenant verification is
claimed by this documentation change.

Source: [Microsoft: connect an agent to an existing MCP server](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent).
See also [Microsoft: configure user authentication for tools](https://learn.microsoft.com/en-us/microsoft-copilot-studio/configure-enduser-authentication).

Keep the server description, verification prompt and setup sequence aligned
with the portal's `content/landing/mcp.ts` and shared MCP connection guide.
