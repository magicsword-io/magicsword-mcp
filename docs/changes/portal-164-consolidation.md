# Portal 1.1.64 MCP consolidation

## Intent and boundary

Combine PRs #13 (clone and assignment), #14 (source dates), and #15 (Free quick
start) into one reviewed release. Source heads: `4cefff0`, `e5ddcc7`, `9c33aa4`.
API contracts were inspected against Portal `4800390f2726dfe55c25d047bf14ca71d2c73a5c`
(release 1.1.64). No Portal changes or production writes belong to this slice.

Assurance: A3 for the confirmation-based policy write boundary. Existing
[clone/assignment behavior IDs](clone-and-assign.md) remain authoritative.
The lead must obtain independent security/release review and green PR CI before
merge. A local fixture does not establish production tenant isolation or native
endpoint application.

| Behavior | Acceptance evidence |
| --- | --- |
| MCP164-001 | All 25 tools work through modern and legacy MCP stdio and real local HTTP transport (`tools-stdio.test.mjs`, package and desktop smoke). |
| MCP164-002 | Clone/assignment use the deployed paths and scopes; tenant/actor input overrides fail, ambiguous writes are never retried, assignment requires the server token (`clone-assignment.test.mjs`). |
| MCP164-003 | Freshness dates stay distinct, nullable/omitted/blank/invalid dates display unknown, structured dates remain unchanged, and HTTP outages cannot appear as an empty successful source list (`intel-sources.test.mjs`). |
| MCP164-004 | Quick Start states Free account/API key access while retaining scope/plan and Enterprise strict-mode restrictions (README review). |

The Portal routes authenticate clone with `policies:write`, groups with
`endpoints:read`, assignment with both, and source discovery with `intel:read`.
Group pages default to 100/max 500; intel pages default to 50/max 100. Assignment
preview freezes concrete IDs, policy content and previous assignments in a
five-minute one-use token; commit sends only that token. Policy content and paid
source restrictions, tenant checks, replay protection and transaction atomicity
remain Portal responsibilities. MCP success states desired assignment pending
check-in, never verified installation. Source discovery exposes metadata, not
premium entry content; source check time does not certify a completed import.

## Validation and release

Local macOS validation: `npm ci`, `npm test` (128 tests plus transport/smoke),
`npm run typecheck`, `npm run release:verify`, `npm audit` (zero advisories),
`npm run test:package`, `npm run bundle:desktop`, `npm run test:desktop`, and
`git diff --check`. No lint script is configured. Cross-platform CI and the
independent review are required separately. Authenticated production API calls,
new database integration execution and native Claude Desktop UI installation are
not claimed by this consolidation; no customer credentials were used.

No workflow or version changes are introduced. Existing main CI automatically
allocates the next stable patch tag and dispatches npm OIDC publication, then
Registry publication and desktop asset upload. A main merge is publication
approval under `docs/RELEASING.md`; this PR's creation does not publish. Keep the
three originals open until the combined PR is merged, then close as superseded.
