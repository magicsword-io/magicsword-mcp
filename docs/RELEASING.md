# Releasing magicsword-mcp

Releases publish `@magicsword-io/magicsword-mcp` to npm and then publish
`io.github.magicsword-io/magicsword-mcp` to the official MCP Registry from
`.github/workflows/publish.yml`. Both publications use GitHub OIDC, so the
release workflow does not require a long-lived token.

Starting with 0.1.4, the workflow also attaches `magicsword-mcp.mcpb` and
`magicsword-mcp.mcpb.sha256` to the same GitHub release after npm publication,
alongside Registry publication. A Registry outage does not block the installer.
The release-creation and asset-upload jobs have `contents: write`; npm/Registry
jobs retain `contents: read` and `id-token: write`. Merging to `main` is the
publication approval. Successful main CI automatically creates the next patch
release and dispatches the checked publication flow without another approval.

The default flow is **merge → main CI → patch release → npm → Registry and desktop
assets**. No manual version bump, tag, GitHub release, npm login or npm publish
is required. Only the latest successful main push is eligible; stale/failed CI,
PRs and forks cannot create a release. Every merge, including docs changes, gets
a patch release. Rapid merges may be combined when an older CI run becomes stale.

Automatic versioning uses the highest stable `v*` tag plus one patch. A manually
higher stable source version can select a minor/major release. The checked-in
version is a synchronized development baseline; the release runner materializes
the tag version in package/lockfile/Registry/desktop metadata before all checks
and builds. The tag still identifies the exact tested main commit. There is no
bot commit to main and no branch-protection bypass. Inspect the installed CLI
or npm for the published version, rather than the development baseline.

## Release acceptance contract

The release path is an A3 change. These behavior IDs link its requirements to
the checks in this repository:

| ID | Required behavior | Evidence |
| --- | --- | --- |
| RELEASE-001 | `npm version` materializes the tag version in build metadata; npm/lockfile/Registry/desktop identities and versions agree, while tracked source may retain its development baseline. | `npm run release:verify -- v<version>`, negative metadata tests and actual stable → beta → stable lifecycle regression in `npm test`. |
| RELEASE-002 | Only public releases from commits already on `main` can publish. | Public-repository and Git ancestry checks in `publish.yml`. |
| RELEASE-003 | Known dependency advisories block publishing, including development dependencies used during builds/tests. | Full `npm audit` in CI, release workflow and `prepublishOnly`. |
| RELEASE-004 | The production tarball installs and exposes the CLI and 25 tools without development dependencies. | `npm run test:package` on all three CI platforms and the Node 24 release runner. |
| RELEASE-005 | Merging to main authorizes automatic patch release after successful current main CI; checked publication proceeds without an Actions approval. | Keep the `npm-release` environment and trusted publisher binding, restrict deployments to release tags, and configure no required reviewers or wait timer. Verify actual environment settings separately from workflow YAML; `auto-release.test.mjs` covers trusted CI, stale runs, retries, version selection and dispatch guards. |
| RELEASE-006 | Partial publication can recover without republishing an immutable npm version. | Registry-only retry, retained desktop artifact recovery and rollback procedures below. |
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
   Settings → Environments. Leave required reviewers empty and the wait timer
   disabled, and allow selected **tags** matching `v*`. Keep this environment:
   npm trusted publishing is bound to its name. Merging to main is
   the maintainer's approval; no additional Actions approval is required. Also
   protect `main` with the CI build/test checks and protect release tags against
   modification and deletion. Keep an active tag ruleset for `refs/tags/v*`
   with **update/deletion** restrictions and admin-only bypass. Leave tag creation
   governed by repository write permissions so GITHUB_TOKEN can create new tags.
   GitHub rejected the built-in Actions app as a ruleset bypass actor here;
   do not assume an app-only creation exception works. Repository writers and
   workflows with contents:write may allocate new release tags, but may not
   replace existing ones. Main/workflow review and pre-publication guards remain
   the trust boundary. The creator rechecks the remote tag SHA before dispatch.
   Actions receives no main bypass or long-lived token. The automatic release
   job also needs actions:write to dispatch publish.yml. Verify these rules in
   GitHub; merely referencing an environment in YAML does not configure them.
   See [GitHub environment protection](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).
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

1. Merge a reviewed PR into `main`. Required Linux/macOS/Windows package checks
   and focused tests must pass before merge.
2. Main CI runs again. `auto-release.yml` accepts only successful push CI from
   this repository at the latest main SHA, creates the next patch release tagged
   at that SHA, and explicitly dispatches `publish.yml` at the tag. Explicit
   dispatch is necessary because releases created with `GITHUB_TOKEN` do not
   trigger another release-event workflow. No long-lived token is needed.
3. `publish.yml` validates the stable public mutable release, tag, exact checkout
   and main ancestry, materializes the tag version, and runs typecheck, full audit,
   tests, installed-package and desktop checks. It refuses existing npm versions
   and publication that would move `latest` backward. Then OIDC publishes npm,
   followed independently by Registry metadata and the exact tested installer.
4. Monitor both workflows and verify npm version/provenance, Registry metadata,
   installer checksums and an authenticated read-only Portal check.

The release creator is serialized. Rerunning the same successful main CI reuses
its existing tag/release and does not dispatch a duplicate queued/running/successful
publication. A failed publication requires inspection and selective failed-job
recovery, not a new version for the same commit. A stale run does nothing; the
newer main run handles the combined change. A merge arriving after the final
freshness check may get its own later release; each tagged source still passed CI.

Manual releases remain a recovery path. A maintainer can publish a new stable
GitHub release at a main commit, or dispatch `publish.yml` on an existing release
tag. A tag push alone does not publish. Dispatching a branch, missing/draft/
prerelease/immutable release, off-main commit or existing npm version fails closed.
For a deliberate minor/major release, update the baseline with
`npm version <version> --no-git-tag-version`, include all four metadata files,
and merge normally. Ordinary patch releases require no version edits.

npm processing may take ten minutes; Registry waits for availability. Rerun only
the failed Registry job if processing takes longer. `npm publish` rebuilds through
lifecycle hooks; local candidate digests are not proof of the published bytes.
The npm-release environment remains restricted to `v*` tags without reviewers
or a wait timer. See [GitHub workflow triggering](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

## First desktop installer release: deployment order

Historical bootstrap procedure for 0.1.4 (subsequent releases use the automatic flow above):

1. Complete actual Claude Desktop installation checks on macOS and Windows
   with a read-scoped Enterprise test key. Merge the reviewed installer PR and
   require the build/test checks on the resulting `main` commit.
2. Deploy the portal setup guide before announcing the installer. Until a
   stable GitHub release contains both assets, the guide keeps terminal setup
   available. The hosted connector can remain disabled throughout this release.
3. Publish a **GitHub release** `v0.1.4` targeting that reviewed `main` commit;
   the workflow publishes automatically after its checks pass. Do not bump
   the version again if package/lockfile/Registry/manifest already say 0.1.4.
   This asset flow requires a mutable release; immutable releases need the
   separate draft-release flow described below.
4. Wait for npm publication and the `publish-desktop` job. Registry publication
   runs independently after npm and does not block desktop asset upload. Verify
   `magicsword-mcp.mcpb` and `magicsword-mcp.mcpb.sha256` are attached, download
   them and verify the checksum, then smoke-test the released installer.
5. Allow the portal's 15-minute release cache to refresh and check the real
   download button and checksum link. Submit the released extension to Claude's
   directory after these checks; announce directory approval only after acceptance.

Hosted Claude/ChatGPT/Grok OAuth is a separate portal rollout. Publishing this
local installer neither enables nor requires that hosted connector. The portal
can continue using published MCP package 0.1.3 until a separate dependency update.
See the [portal download UI screenshots](CLIENT_SETUP.md#installer-guide-screenshots)
for the fixture-based review views; these do not show native Claude installation.

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
  actually published the version, recover the Registry manually from a clean checkout of the same
  release tag. First materialize its version with
  `npm version <tag-without-v> --no-git-tag-version --allow-same-version` and
  `npm run release:verify -- <tag>`, because source may retain an older baseline.
  Then use `mcp-publisher login github` and
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

## Recover desktop assets after npm was accepted but its job failed

If npm accepted the version but `publish-npm` failed afterward, both downstream
jobs are skipped. Rerunning that npm job cannot overwrite the published version.
Use the Registry-only recovery above and recover desktop assets separately from
`desktop-release-v<version>` in that original run. The workflow retains the
**tested bytes for 90 days**, subject to repository retention/deletion settings.
Never rebuild a replacement for this recovery, move the tag, delete existing
assets, or use `--clobber`. If the artifact is missing/expired, its checksum or
version differs, or an existing asset differs, stop for maintainer review and
plan a new release instead.

Review the original run's successful metadata, audit, package and desktop test
steps, artifact upload, and npm publication failure before proceeding. Confirm
the published npm version and provenance belong to this release commit; version
matching alone does not establish provenance. The checksum establishes byte
integrity, not publisher identity. Run these commands in **Bash** with `gh`,
`npm`, Python 3 and `shasum` installed, after setting the actual original run ID:

```bash
set -euo pipefail
repo=magicsword-io/magicsword-mcp
tag=v0.1.4
run_id=REPLACE_WITH_ORIGINAL_RUN_ID
version="${tag#v}"
recovery_dir="$(mktemp -d)"

gh run view "$run_id" --repo "$repo" \
  --json headSha,event,workflowName,jobs,url
# Inspect the jobs above; this must be the original Publish npm package run.
case "$(gh run view "$run_id" --repo "$repo" --json event --jq .event)" in
  release|workflow_dispatch) ;;
  *) exit 1 ;;
esac
test "$(gh run view "$run_id" --repo "$repo" --json workflowName --jq .workflowName)" = 'Publish npm package'
test "$(gh run view "$run_id" --repo "$repo" --json headSha --jq .headSha)" = \
  "$(gh api "repos/$repo/commits/$tag" --jq .sha)"
gh api "repos/$repo/releases/tags/$tag" > "$recovery_dir/release.json"
python3 - "$recovery_dir/release.json" "$tag" <<'PYTHON'
import json, sys
release = json.load(open(sys.argv[1]))
assert release['tag_name'] == sys.argv[2]
assert release.get('immutable') is False, 'Immutable release: stop recovery'
assert not release['draft'] and not release['prerelease']
PYTHON
test "$(npm view "@magicsword-io/magicsword-mcp@$version" version)" = "$version"
gh run download "$run_id" --repo "$repo" \
  --name "desktop-release-$tag" --dir "$recovery_dir/tested"
(cd "$recovery_dir/tested" && shasum -a 256 --check magicsword-mcp.mcpb.sha256)
python3 - "$recovery_dir/tested/magicsword-mcp.mcpb" "$version" <<'PYTHON'
import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as bundle:
    manifest = json.loads(bundle.read('manifest.json'))
    package = json.loads(bundle.read('package.json'))
assert manifest['version'] == package['version'] == sys.argv[2]
assert package['name'] == '@magicsword-io/magicsword-mcp'
PYTHON

# External write: run only after reviewing the checks and provenance above.
# Compare ALL existing assets before uploading any missing ones.
gh release view "$tag" --repo "$repo" --json assets --jq '.assets[].name' \
  > "$recovery_dir/existing-assets"
for asset in magicsword-mcp.mcpb magicsword-mcp.mcpb.sha256; do
  if grep -Fxq "$asset" "$recovery_dir/existing-assets"; then
    gh release download "$tag" --repo "$repo" --pattern "$asset" \
      --dir "$recovery_dir/existing"
    cmp "$recovery_dir/tested/$asset" "$recovery_dir/existing/$asset"
  fi
done
for asset in magicsword-mcp.mcpb magicsword-mcp.mcpb.sha256; do
  if ! grep -Fxq "$asset" "$recovery_dir/existing-assets"; then
    gh release upload "$tag" "$recovery_dir/tested/$asset" --repo "$repo"
  fi
done
gh release download "$tag" --repo "$repo" --pattern 'magicsword-mcp.mcpb*' \
  --dir "$recovery_dir/published"
for asset in magicsword-mcp.mcpb magicsword-mcp.mcpb.sha256; do
  cmp "$recovery_dir/tested/$asset" "$recovery_dir/published/$asset"
done
(cd "$recovery_dir/published" && shasum -a 256 --check magicsword-mcp.mcpb.sha256)
```

Keep the run URL, release commit, checksum and comparison results as sanitized
release evidence, then complete the released-installer and download-link checks
above. A concurrent upload causes a safe failure rather than replacement; repeat
the comparison procedure before resuming. See the GitHub CLI documentation for
[artifact download](https://cli.github.com/manual/gh_run_download) and
[release upload](https://cli.github.com/manual/gh_release_upload).

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
