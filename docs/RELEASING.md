# Releasing magicsword-mcp

Releases publish `@magicsword-io/magicsword-mcp` to npm from
`.github/workflows/publish.yml`. The workflow uses npm trusted publishing
(OIDC), so it does not require a long-lived npm token.

## One-time npm setup

1. Ensure the `@magicsword-io` npm organization owns the package.
2. Configure the package's npm trusted publisher for:
   - GitHub organization: `magicsword-io`
   - Repository: `magicsword-mcp`
   - Workflow: `publish.yml`
   - Allowed action: `npm publish`
3. Require two-factor authentication for package maintainers and disallow
   token-based publishing after the trusted publisher is working.

Trusted publishing requires npm CLI 11.5.1 or newer. The release workflow uses
Node 24 on a GitHub-hosted runner, grants only `contents: read` and
`id-token: write`, and receives automatic npm provenance for a public package.

## Release

1. Update `version` in `package.json` and `package-lock.json`.
2. Run `npm ci`, `npm test`, `npm audit --omit=dev`, and `npm pack --dry-run`.
3. Merge the version change to `main`.
4. Publish a GitHub release tagged exactly `v<package version>`.

The workflow refuses to publish if the release tag and package version differ.
