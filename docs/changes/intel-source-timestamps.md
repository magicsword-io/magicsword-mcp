# Intelligence source timestamps

`list_intel_sources` now includes `created_at`, `updated_at`, `last_sync`, and
`last_checked_at` in its readable summary, as returned by
`GET /api/public/v1/intel/sources`. Structured content preserves the API response.

Dates are optional and nullable for compatibility with older portal versions.
Missing dates display as `unknown`; they never fall back to a different date.
`updated_at` covers source metadata/content writes. `last_sync` is the existing
source sync timestamp. Neither proves an unchanged source was checked recently.
`last_checked_at` records a successful collector collection, including unchanged
content, and does not certify a complete entry import or policy update.

The portal supplies these dates; this change does not add requests or new scopes.
Build and regression coverage: `npm test`, including
`scripts/intel-sources.test.mjs` and the existing stdio contract tests.
