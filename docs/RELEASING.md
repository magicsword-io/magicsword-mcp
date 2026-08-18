# Releasing magicsword-mcp

Releases publish `@magicsword-io/magicsword-mcp` to npm and then publish
`io.github.magicsword-io/magicsword-mcp` to the official MCP Registry from
`.github/workflows/publish.yml`. Both publications use GitHub OIDC, so the
release workflow does not require a long-lived token.

## One-time public-repository setup

1. Make the GitHub repository public. npm provenance is not generated from a
   private repository, and the MCP Registry GitHub namespace is intended for a
   public server repository.
2. Ensure the `@magicsword-io` npm organization exists and your npm account can
   publish public scoped packages with 2FA.
3. Bootstrap the package once because npm cannot configure a trusted publisher
   until the package exists. From a temporary clean checkout of the intended
   first release commit, run:

   ```sh
   npm ci
   npm version 0.1.0-beta.0 --no-git-tag-version
   npm test
   npm pack --dry-run
   npm login
   npm publish --tag next --access public
   ```

   This publishes the real release candidate without consuming stable version
   `0.1.0`. Do not merge the temporary prerelease version change.
4. Configure the package's npm trusted publisher for:
   - GitHub organization: `magicsword-io`
   - Repository: `magicsword-mcp`
   - Workflow: `publish.yml`
   - Allowed action: `npm publish`
5. Require two-factor authentication for package maintainers and disallow
   token-based publishing after the trusted publisher is working.

Trusted publishing requires npm CLI 11.5.1 or newer. The release workflow uses
Node 24 on a GitHub-hosted runner, grants only `contents: read` and
`id-token: write`, and receives automatic npm provenance for a public package.

The prerelease bootstrap is the only manual npm publish. Stable `0.1.0` can
then use the automated workflow normally.

## Each release

1. Update `version` in `package.json`, `package-lock.json`, and `server.json`.
2. Run `npm ci`, `npm test`, `npm audit --omit=dev`, and `npm pack --dry-run`.
3. Merge the version change to `main`.
4. Publish a GitHub release tagged exactly `v<package version>`.

The workflow refuses to publish if the release tag, npm package version, and
MCP Registry version differ. It publishes npm first, waits for that package to
be visible, then validates ownership through GitHub OIDC and publishes
`server.json` to the official Registry.
