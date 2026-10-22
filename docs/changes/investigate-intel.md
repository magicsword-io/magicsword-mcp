# Investigate and intelligence workflows

Assurance: A2 for MCP integration. The service enforces authentication,
organization boundaries, and write authorization. No release or deployment is
part of this change.

## Behaviors

- INV-001: `list_events` combines type, status, exact literal `file_name`, time,
  endpoint and policy filters. The time window uses last observation, falling
  back to creation time. Text and structured output retain every returned row,
  IDs, investigation context, and pagination. Raw telemetry is excluded.
- INTEL-001: `list_intel_sources` discovers global and organization-owned source
  metadata with IDs, default enabled=true, platform filtering and pagination.
  Requires `intel:read`; reports API failures without claiming an empty list.
- INTEL-002: policy discovery and current attachments expose names and IDs.
  Attachments use the existing policy write contract and verified saved/skipped
  counts. Duplicate attachments are no-ops, and writes are never retried.

## Acceptance evidence and stop rules

Run the full existing MCP suite, including modern/legacy stdio HTTP contracts,
new investigation/source tests, typecheck, package installation smoke, and audit.
Exercise an authenticated local service with real database queries and synthetic
tenant fixtures: discover policies/sources, filter events, attach/list/duplicate/
detach, and reject wrong scopes/foreign resources. Independently review the
diff and security boundaries. If real integration cannot pass, push the MCP
branch for handoff without opening its PR.

Preserve existing tool names. Do not deploy, merge, alter real endpoint policies,
or persist credentials. Rollback is reverting the feature commits.
