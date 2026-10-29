# Create a policy from MCP

Assurance: A3 for the existing privileged customer API mutation boundary.
No production policy creation, assignment, enforcement, release or deployment
is part of implementation or verification.

- CREATE-001: `create_policy` accepts a required name and platform (Windows,
  macOS or Linux), plus optional policy_mode (blocklist by default, or strict).
  Names are trimmed, 1–200 characters and contain no control characters.
  Unsupported fields are rejected. Linux strict is unsupported and rejected.
- CREATE-002: POST `/api/public/v1/policies` requires policies:write and uses
  the authenticated organization's ID and key creator as the sole tenant/actor
  authority. Strict mode requires Enterprise. Free can create blocklist policies.
- CREATE-003: The server atomically creates an empty policy, its first audit
  version, the current-version pointer and creation audit record. Failure rolls
  back all creation writes. Existing organizational collection inheritance may
  apply. No rules, feeds, default-policy pointers or device assignments are added.
- CREATE-004: MCP validates the returned policy identity, initial version,
  name/platform/mode and audit state before claiming success. Writes are never
  automatically retried. Ambiguous outcomes instruct callers to list policies
  before retrying. Subsequent rule/source additions use their existing tools.

Evidence: schema/response/failure tests, modern+legacy stdio HTTP contracts,
real local PostgreSQL transaction and ACL checks, authenticated HTTP creation
and readback for all platforms/supported modes, plan/scope/tenant rejection,
injected failure rollback, unchanged default/assignment state, package and desktop
smoke, full static/test gates and independent API-boundary review. No native
endpoint behavior is claimed. Deploy Portal route+RPC before publishing clients.
Rollback: revert feature commits and remove the unreferenced service-only RPC.
