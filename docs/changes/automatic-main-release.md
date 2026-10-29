# Automatic publication after merge

Assurance: A3 release path. User authorizes CI automation, merge and a public
release containing create_policy. Existing Portal feature is merged. Successful
production policy creation remains unverified because the saved key lacks write
scope; production release verification uses read-only MCP calls.

- AUTO-001: Only successful same-repository main push CI at the current main
  commit can create a release. PR/fork/failed/cancelled/stale runs do nothing.
- AUTO-002: A new commit gets the next stable patch after the highest stable
  release tag, or a manually higher stable baseline. Repeated processing of the
  same SHA reuses its tag and never creates another version or duplicate run.
- AUTO-003: GitHub release creation explicitly dispatches publish.yml at the
  tag using built-in GITHUB_TOKEN. No long-lived token or main bypass is added.
  Repository write access may create new tags; updates/deletion remain admin-only.
  Remote tag SHA is rechecked before dispatch to reject concurrent allocation.
- AUTO-004: Publishing requires a public repository, stable published mutable
  release, exact tag checkout and main ancestry. Build metadata is synchronized
  to the tag in npm and Registry jobs. No source or lock dependency edits occur.
- AUTO-005: Full audit/typecheck/tests, installed tarball and desktop checks gate
  OIDC publication. Existing npm versions and latest rollback fail closed. Failed
  partial publications retain existing selective Registry/desktop recovery.
- AUTO-006: Real release evidence includes both successful automation runs,
  npm latest/provenance, installed 23-tool artifact on both protocol modes,
  authenticated production reads, Registry metadata and desktop checksum.

Tests: orchestration API-boundary tests for eligibility, freshness before writes,
version selection, interrupted release/dispatch, duplicate and failed run handling;
dispatch and npm rejection cases; actual npm lifecycle synchronization; actionlint;
existing package/desktop/stdio suites. Independent release review required before
merge; actual settings and first successful automatic publication before closure.

Rollback: revert automatic workflow/script changes through a reviewed PR; suspend
auto-release.yml if needed to stop new releases. Never move/delete release tags
or replace npm versions. Recover an existing failed publication selectively.
