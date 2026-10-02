# Vendored anti-slop provenance

Source: [dmmulroy/anti-slop at c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b](https://github.com/dmmulroy/anti-slop/tree/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b).
Reviewed and copied on 2026-10-02. The pinned README recommends owning a vendored
copy rather than installing an unofficial npm package. Its manifest uses matching
`oxlint` / `@oxlint/plugins` 1.78.0; its install guidance says to query the current
registry pair for a new installation. This checkout uses exact **1.86.0** pins for
both, verified from `https://registry.npmjs.org/` and through the Bun CLI tests.
The JavaScript plugin API is still alpha; upgrade both pins together and rerun the
integration and tooling type checks.

## Copied source and attribution

- `src/index.ts`, generic `src/rules/`, `src/shared/`, and
  `src/vendor/eslint-stylistic/` production files live here with identical bytes.
- All upstream `*.test.ts` files are excluded. They are upstream's test harness,
  not this project's Bun tests; the spacing CLI test invokes pnpm.
- `src/effect/`, installers, agent assets, upstream configuration and manifests
  are excluded. No upstream installer was executed.
- Root `LICENSE` is the original MIT license, copyright Dillon Mulroy.
- Nested `vendor/eslint-stylistic/LICENSE` and `UPSTREAM.md` remain verbatim,
  preserving OpenJS Foundation and ESLint Stylistic attribution and commit
  `435c3ea0fd26a5fef9042c4b36b6e165fbbf8d08`.
- `SOURCE-SHA256.json` records every copied file including both licenses and the
  nested provenance. The local vendor boundary test verifies these bytes.

## Local policy and review

No vendored production code was modified. `oxlint.anti-slop.config.ts` enables
three custom rules and native `oxc/no-accumulating-spread` as warnings only in
`lib`. All other generic policies are off, including the `shape` symbol ban.
Biome excludes this directory to preserve reviewed source and nested attribution.
The normal package publishes only `dist`, so this tooling is not shipped to users.

Before execution, the selected rules and array/scope helpers were read, imports
and top-level registration were inspected, and the generic production tree was
checked for filesystem, network, process execution and dynamic evaluation APIs.
Imports are limited to `@oxlint/plugins` and local production modules. The copied
code examines AST/scope/token data and reports diagnostics; it does not run the
source being linted. The retained spacing factory constructs a disabled rule.
This review and integration coverage do not constitute a comprehensive security
audit or full upstream rule conformance suite. Official package metadata lists
no lifecycle scripts for either new dependency; Oxlint uses a platform native
binding distributed by the official npm package.

For updates, stage an explicit upstream commit separately, compare the recorded
files and licenses, retain local policy, review changed code before executing it,
then update this record and hashes. Do not copy upstream tests or enable newly
added policies automatically. See [the local adoption notes](../../../docs/anti-slop.md).
