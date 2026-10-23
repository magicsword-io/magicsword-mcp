# MCPB manifest schema

`manifest-v0.3.schema.json` and `LICENSE` are copied unchanged from the official
`@anthropic-ai/mcpb@2.1.2` npm package (`schemas/mcpb-manifest-v0.3.schema.json`).
Upstream: https://github.com/modelcontextprotocol/mcpb.

The build validates against this schema, then produces the documented ZIP
format with `fflate`. The full MCPB CLI is not a dependency: its signing and
interactive setup dependencies currently introduce unresolved advisories.
This builder does not sign bundles. Do not describe an unsigned candidate as
publisher-verified or directory-approved.
