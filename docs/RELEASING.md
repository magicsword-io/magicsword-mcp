# Releasing magicsword-mcp

Releases publish `@magicsword-io/magicsword-mcp` to npm and then publish
`io.github.magicsword-io/magicsword-mcp` to the official MCP Registry from
`.github/workflows/publish.yml`. Both publications use GitHub OIDC, so the
release workflow does not require a long-lived token.

Starting with 0.1.4, the workflow also attaches `magicsword-mcp.mcpb` and
`magicsword-mcp.mcpb.sha256` to the same GitHub release after npm publication,
alongside Registry publication. A Registry outage does not block the installer.
Only the asset-upload job has `contents: write`; npm/Registry jobs
retain their existing permissions and approval gate.

## Release acceptance contract

The release path is an A3 change. These behavior IDs link its requirements to
the checks in this repository:

| ID | Required behavior | Evidence |
| --- | --- | --- |
| RELEASE-001 | `npm version` updates Registry versions automatically; tag, npm/lockfile versions, Registry version and npm reference agree; package identities agree. | `npm run release:verify -- v<version>`, negative metadata tests and actual stable → beta → stable lifecycle regression in `npm test`. |
| RELEASE-002 | Only public releases from commits already on `main` can publish. | Public-repository and Git ancestry checks in `publish.yml`. |
| RELEASE-003 | Known dependency advisories block publishing, including development dependencies used during builds/tests. | Full `npm audit` in CI, release workflow and `prepublishOnly`. |
| RELEASE-004 | The production tarball installs and exposes the CLI and 22 tools without development dependencies. | `npm run test:package` on all three CI platforms and the Node 24 release runner. |
| RELEASE-005 | A maintainer approves public npm publication. | Configure the `npm-release` environment's required reviewer and trusted publisher binding below. Workflow configuration alone does not install protection rules. |
| RELEASE-006 | Partial publication can recover without republishing an immutable npm version. | Registry-only retry and rollback procedure below. |
| RELEASE-007 | The desktop bundle has the same version, securely collects a user key, and starts without global packages or saved credentials. | `bundle:desktop`, `test:desktop`, and manifest/version checks on macOS, Windows, and Linux CI runners. |

Local checks establish candidate readiness. GitHub/npm settings, successful OIDC
publication, provenance and an authenticated Portal check establish release
readiness; do not infer those from a local green build.

## One-time public-repository setup

1. Make the GitHub repository public. npm provenance is not generated from a
   private repository, and the MCP Registry GitHub namespace is intended for a
   public server repository.
2. Ensure the `@magicsword-io` npm organization exists and your npm account can
   publish public scoped packages with 2FA.
3. Create a GitHub environment named exactly `npm-release` under repository
   Settings → Environments. Configure a required reviewer, disable administrator
   bypass, and allow selected **tags** matching `v*`. The npm publishing job uses
   this environment. Also protect `main` with the CI build/test checks and protect
   release tags against unauthorized creation, modification and deletion. Verify
   these rules in GitHub; merely referencing an environment in YAML does not
   configure reviewer protection. Required reviewers on GitHub Free/Pro/Team
   require a public repository. See [GitHub environment protection](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).
4. Bootstrap the package once because npm cannot configure a trusted publisher
   until the package exists. From a temporary clean checkout of the intended
   first release commit, run:

   ```sh
   npm ci
   npm version 0.1.0-beta.0 --no-git-tag-version
   npm run release:verify
   npm test
   npm run test:package
   npm audit
   npm pack --dry-run
   npm login
   npm publish --tag next --access public
   ```

   This publishes the real release candidate without consuming stable version
   `0.1.0`. Do not merge the temporary prerelease version changes. Check
   `npm view @magicsword-io/magicsword-mcp dist-tags --json` after bootstrap;
   do not announce the package as stable until `latest` points at a validated
   stable version.

   The `version` lifecycle hook synchronizes both Registry version fields. If
   you already changed the npm version using older instructions, recover with
   `npm run release:sync`, then `npm run release:verify` and `npm test`; do not
   repeat the same `npm version` command. npm has already changed package/lock
   versions if the hook fails: correct the reported metadata/lock issue and run
   `release:sync` again. Do not use `--ignore-scripts` for version changes; it
   skips synchronization. The sync command verifies identities and lockfile
   consistency before writing and does not change the npm version.
5. Configure the package's npm trusted publisher for:
   - GitHub organization: `magicsword-io`
   - Repository: `magicsword-mcp`
   - Workflow: `publish.yml`
   - Environment: `npm-release`
   - Allowed action: explicitly enable direct `npm publish`

   New trusted publishers default to staged publishing. This workflow uses
   direct publishing, so stage-only permission will not work. Complete the first
   successful publish within **two days** of creating the configuration; if it
   expires, delete it and recreate it immediately before release. Do not create
   a GitHub prerelease for the bootstrap: it is a manual npm publish only.
6. Require two-factor authentication for package maintainers and disallow
   token-based publishing after the trusted publisher is working.

Trusted publishing requires npm CLI 11.5.1+ and Node 22.14.0+. The release
workflow uses Node 24 and pinned npm 11.12.0 on a GitHub-hosted runner, grants
only `contents: read` and `id-token: write` to publishing jobs, disables build
caching, and receives automatic npm provenance for a public package from a
public repository. Public npm packages can have private source repositories,
but that path does not produce provenance and is not this release contract.
See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

The prerelease bootstrap is the only manual npm publish. Stable `0.1.0` can
then use the automated workflow normally.

## Each release

1. Update `version` in `package.json`, both root version fields in
   `package-lock.json`, and both `server.json` version locations (the top-level
   server and `packages[0].version`). `npm version <version> --no-git-tag-version`
   updates all of them through the version hook. After a beta bootstrap in your
   working checkout, use `npm version 0.1.0 --no-git-tag-version` to return all
   metadata to the intended first stable version before merging/releasing.
2. Run `npm ci`, `npm run release:verify -- v<version>`, `npm run typecheck`,
   `npm test`, `npm audit`, `npm run test:package`, `npm run bundle:desktop`, and
   `npm run test:desktop`. The version hook also updates `manifest.json`.
3. Merge the reviewed change to `main` and verify all CI checks pass.
4. Publish a GitHub release tagged exactly `v<package version>` targeting that
   `main` commit. Pushing a tag alone does not trigger this workflow.
5. Inspect the pending run and approve its `npm-release` environment deployment
   only after the candidate checks, review and an authenticated Portal check.

The workflow checks every version and identity, rejects private repositories
and off-main commits, runs the full audit and installed production package
check, then publishes npm. It waits up to ten minutes for npm processing to make
the package visible before publishing Registry metadata through GitHub OIDC. If
npm processing takes longer, wait for `npm view` to find the version and rerun
only the failed Registry job. Release runs are serialized.
Package smoke tests install a real temporary tarball; `npm publish` subsequently
rebuilds via lifecycle hooks. The locally tested digest is candidate evidence,
not proof that a particular tarball was published.

## Verify the public release

```sh
npm view @magicsword-io/magicsword-mcp@0.1.0 version dist.integrity --json
npm view @magicsword-io/magicsword-mcp dist-tags --json
npm install -g @magicsword-io/magicsword-mcp@0.1.0
magicsword-mcp --version
magicsword-mcp configure
curl -fsS 'https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.magicsword-io/magicsword-mcp'
```

Replace `0.1.0` with the released version. Verify the npm provenance badge and
Registry version/package reference. In an MCP client, use a real Enterprise key
to call `whoami` and a read-only tool such as `list_endpoints`; also confirm a
scoped key receives the expected denied response for a scope it does not have.
Do not exercise fleet mutations just to smoke-test publication. Never retain
the key or customer response bodies in release evidence.

## Partial publication and rollback

- If npm fails before publishing, correct the setup and rerun the failed job.
  Check the registry first when the failure occurred during `npm publish`, since
  a network error can occur after npm accepted the version.
- If npm succeeded but the MCP Registry job failed, rerun **only failed jobs**:
  `gh run rerun RUN_ID --failed --repo magicsword-io/magicsword-mcp`.
  Do not rerun all jobs: npm versions cannot be overwritten. If a failed npm job
  actually published the version, recover the Registry manually from the same
  release commit with `mcp-publisher login github` and
  `mcp-publisher publish server.json`; organization namespace login requires an
  authorized organization owner. Do not delete or move the original release tag.
- If Registry publication reports an existing version, inspect its metadata
  before retrying. Correct published metadata through a new release; do not
  silently replace it with a different artifact.
- For a bad stable release, deprecate the affected npm version with a specific
  explanation and, if a known-good stable version exists, move `latest` back:

  ```sh
  npm deprecate '@magicsword-io/magicsword-mcp@BAD_VERSION' 'Use GOOD_VERSION; explain the regression here.'
  npm dist-tag add '@magicsword-io/magicsword-mcp@GOOD_VERSION' latest
  ```

  These are separately authorized maintainer actions with interactive 2FA.
  Dist-tag management requires its own permission if automated through OIDC.
  Already installed users must explicitly install the known-good version. On
  the first release there is no earlier stable version to roll back to: deprecate
  the bad version and ship a fixed patch version. Publish corrected Registry
  metadata in that new release and update the release notes. Keep published
  artifacts and tags immutable; do not use unpublish as routine rollback.

## Desktop installer and directory submission

The installer is produced from an explicit allow-list and locked production
dependencies with npm lifecycle scripts disabled. It is validated with a
vendored copy of the official MCPB 0.3 schema. ZIP ordering and timestamps are
fixed; checksums can be reproduced on the same source/dependency set. Build
dependencies are not included in the installer. The bundle is currently
unsigned; a checksum establishes byte integrity, not a verified publisher.
The gated npm job retains the exact tested installer as a workflow artifact;
the write-scoped upload job only downloads, verifies, and attaches those bytes.
It does not check out source code, install dependencies, or rebuild the bundle.
The current latest release was checked as mutable. Enabling immutable GitHub
releases requires a separate draft-release asset flow; the workflow rejects
immutable release events before publishing npm.

CI tests unpack the actual bundle into a temporary clean installation and
exercise both MCP protocol modes against a local HTTP fixture. Before public
distribution, also install the candidate in actual Claude Desktop on macOS and
Windows with a read-scoped Enterprise test key. Verify key collection and the
correct organization without saving customer response bodies or credentials.
Local protocol tests do not prove the native Claude installer UI works.

After release, verify both assets are present in GitHub Releases and that the
portal `/mcp` download button appears (its release check refreshes every 15
minutes). If only the desktop upload job fails, rerun that failed job; do not
rerun successful immutable npm publication. The upload intentionally does not
overwrite existing assets. If an interrupted upload left an asset, a rerun
downloads and compares its bytes with the tested artifact, then uploads only
missing assets. A mismatch fails and requires maintainer review; it is never
silently overwritten.

Submit the extension through the
[Claude Desktop extension submission form](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop).
Use the release asset URL, the project support/documentation links, an
Enterprise demo organization with synthetic devices/events, and a demo of
`whoami`, device discovery, and a read-only policy/intelligence workflow. Share
reviewer access only through the submission provider's secure form. A release
is downloadable before directory approval; it must not be described as
Anthropic-reviewed until accepted.

See [GitHub selective reruns](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs)
and [npm dist-tags](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag/).
