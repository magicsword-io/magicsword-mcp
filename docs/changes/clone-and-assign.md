# Policy clone and targeted assignment

User outcome: conversationally clone an existing same-organization policy and
assign it to a computer, explicit computers, hostname-matched computers, or the
current members of endpoint groups. Open both PRs only; no merge, release,
production data mutation, device/agent operation, or cloud infrastructure change.
Assurance A3 because policy assignments affect endpoint desired state.

- CLONE-001: POST /api/public/v1/policies/{policyId}/clone {name} requires
  policies:write. Strict input (name trimmed1-200/no controls; no org/actor/status
  overrides), org/actor come only from authenticated customer API context.
- CLONE-002: One service-only SECURITY INVOKER fixed-search-path transaction
  clones a pinned current version into an independent same-platform policy,
  audit/version1/no parent, unassigned/non-default. Copy supported policy-row and
  version settings, ALL rules with semantic/provenance fields and remapped
  source-rule signer/file-attribute IDs, intel links+sync watermarks, canonical
  and compatibility analytics collection links. Do not clone history, generated
  artifacts, underlying feeds/collections or assignments. Source is unchanged.
  Snapshot all source children in one statement, no PostgREST pagination limit.
- CLONE-003: Fail closed on missing/foreign/stale source, unsupported content,
  source plan restrictions (including paid AMSI/intel), or any copy/audit
  failure, with all transaction writes rolled back. No silent rule/source omissions.
  Malformed or missing readback AFTER a possible commit is an uncertain outcome;
  it cannot roll back that commit. No automatic POST retries; list policies first.
- ASSIGN-001: GET /api/public/v1/endpoint-groups (endpoints:read) returns paginated
  org-scoped groups with parent IDs. New assignment-preview route accepts exactly
  one selector: endpoint_ids[1..500], hostname_pattern, or group_ids[1..50] with
  include_descendants defaulttrue. Groups expand tenant-fenced, cycle-safe,
  deduplicated; >500 targets or any invalid/foreign/agentless/uninstalled/platform-
  mismatched target rejects the entire request, no partial silent skip.
- ASSIGN-002: POST /policies/{id}/assignment-preview requires policies:write plus
  endpoints:read and normal plan gate. It returns policy ID/version/status/mode,
  concrete targets (id/name/platform/previous assignments), replacement semantics,
  token+expiry (five minutes, 32 random bytes); no endpoint mutation. Persist hashed one-time action policy.assign
  token bound to API key, org, actor, policy/current version and effective mode/status/content
  fingerprint plus exact non-empty target snapshot.
- ASSIGN-003: POST /policies/{id}/assign {confirmation_token} has same scopes and
  current plan gate. One service-only transaction locks token/policy/endpoints,
  checks current version, all ownership/platform/lifecycle/agent eligibility and
  prior assignments, atomically updates policy_id+desired_policy_ids=[policyId]
  and updated_at plus audit and consumes token. Wrong key/org/policy, expiry,
  replay, stale policy/assignments or injected write/audit failure cause no writes.
  Group membership is a preview snapshot: no re-expansion or future binding.
  No automatic retries. Result proves desired state only, never device installation.
- MCP-001: New clone_policy and list_endpoint_groups tools; enhance existing
  apply_policy_to_endpoints to use server preview/token commit for IDs/hostname/
  groups. Confirm=true without server token cannot write. Validate success response
  identities/counts/status. Both modern/legacy stdio; exactly25 registered tools.
  Hosted MCP exposes same tools/semantics/scopes without duplicate registration,
  despite its older pinned npm package. No key or tenant data logged.
- DOC-001: README tool table, scopes, examples for one/many/groups and clone->
  preview->confirmation; audit copy/replacement/snapshot/desired-state/limits,
  deployment order Portal migration/routes before npm, legacy bool warning.

Evidence: tracked unit/API tests, real local native PostgreSQL tests including
>1000 rules, reference graphs, three platforms, tenant/scope/plan denials,
all-or-nothing rollback, one-time token concurrency; real MCP->HTTP->DB if feasible;
package/desktop checks; scoped static gates; independent design/security review.
No production writes, native endpoint application or UI behavior is claimed.
