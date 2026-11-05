# Generated policy download (A3)

User intent: agentless customers retrieve current generated Windows WDAC or
AppLocker policy artifacts via Customer API/MCP, and local MCP can save a new
file to Downloads or an explicitly requested directory.

- DOWNLOAD-001: Strict UUID/format inputs; absolute or ~/ local output directory;
  no arbitrary URL, organization, execution, overwrite or deployment arguments.
- DOWNLOAD-002: GET authenticated current-version export, same Portal generators;
  exact binary bytes, version UUID, member count, SHA256. ZIP contains complete
  base/supplemental/signer/customer/intelligence XML set. Default format WDAC.
- DOWNLOAD-003/004/010: Validate content type, metadata, single-root XML, no DTD or
  entities, valid UTF8, ZIP flat XML names, no duplicates/traversal, matching local
  and central headers, actual bounded inflation, sizes and CRC before filesystem
  mutation. Bounds: 32 MiB response, 30 MiB expanded, 4096 XML members, depth256.
  Production API uses ordinary ZIPs without ZIP64/data descriptors/encryption.
- DOWNLOAD-005/006: Exclusive create mode0600, no final-path symlink or file
  overwrite, suffix on collision, cleanup after write failure, no extracted or
  executed artifacts. Defaults to server-host ~/Downloads, report actual path.
- DOWNLOAD-007/008/009: Binary HTTP API with60s minimum generation budget, no
  retries/redirects, no key/body/XML in failures. Scope/plan/tenant/errors produce
  no file. HTTP generation itself has50s response deadline.
- DOWNLOAD-011: Modern and legacy stdio discover26tools and exercise both binary
  API contracts with persisted file-byte comparisons. Package-only production
  dependency install and desktop bundle must expose the tool.
- DOWNLOAD-012: Hosted MCP rejects local filesystem inputs and returns embedded
  resource+safe filename/hash/version/count. Up to2MiB inline so base64JSON fits
  the4.5MB buffered response envelope. Larger responses explain authenticatedAPI
  orlocalMCP fallback without exposing credentials or public/signedURLs.
- DOWNLOAD-015: A 1001-member archive must survive actual authenticated binary
  HTTP and local save byte-for-byte; over4096 must reject as a whole, never truncate.
- DOWNLOAD-013: AppLocker blocklist projection preserves source audit/enforcing
  mode. Return aggregate projection summary + explicit omission/semantic warning.
  Never claim WDAC strict equivalence, compilation, installation or assignment.

Real producer and access review is tracked in Portal
`docs/change-contracts/customer-policy-download.md` and API documentation beside
it. Tests link stable DOWNLOAD IDs; actual Next handlers + nativePG/PostgREST
integration evidence lives in Conductor .context/policy-download (no secrets).

Stop on tenant leakage, changed enforcement, unbounded decompression, incomplete
artifact success, output overwrite, credential redirect, or claims of hosted
filesystem save. Independent review before READY; Portal API deploy must precede
MCP publication. No production mutation, deployment, merge or npm release is part
of this implementation. Existing main merges trigger automatic npm release.

Limitations: artifact export is not Windows installation proof. No compiledCIP,
macOS/Linux export, old-version selection or endpoint binding. Cache metadata is
not written; unset GUID metadata may generate fresh IDs. Synchronous generator
work cannot be forcibly cancelled after timeout. Hosted client resource-save UX
varies; no authenticated browser/native-client/UI changes are claimed.
