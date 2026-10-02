# Full anti-slop adoption

The follow-up user-approved configuration enables **all 24 pinned rules at error
severity**: 18 generic rules, five Effect plugin rules, and the paired native
`oxc/no-accumulating-spread`. Run `bun run lint:anti-slop` at the repository root.
It explicitly uses Bun for TypeScript config/plugin loading. Biome, Bun tests,
existing snapshots, typecheck and build retain their existing commands and role.

This is a full diagnostic rollout with reviewed initial code fixes, not a completed
migration. Lint currently exits **1** with **851 errors**. No enabled rule has been
downgraded, capped or switched off. The CI job remains advisory and records each
step outcome plus the full JSON diagnostic artifact. A green advisory job can
contain a failed lint step; inspect its summary and artifact. Setup, plugin,
integration and typecheck failures are not caught or converted into success.
The diagnostic step redirects JSON directly to a regular file and retains the
lint failure status. Under CI Bun 1.3.8, the earlier pipe through `tee` truncated
JSON at exactly 65,536 characters. A separate step parses and validates the whole
report, requires 24 active rules, and publishes per-rule counts. A malformed or
missing report fails that step visibly. The advisory job also checks repository
Biome formatting.

## Provenance and scope

The production source is pinned to
[dmmulroy/anti-slop c44ef22](https://github.com/dmmulroy/anti-slop/tree/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b).
All 39 copied files retain their reviewed bytes and SHA-256 records. Root MIT and
nested ESLint Stylistic attribution are preserved. Upstream tests, installers and
agent assets remain excluded. Its private manifest is not an official npm
release; the pinned install guidance recommends vendoring reviewed production
rules. No upstream installer was executed.

Oxlint and `@oxlint/plugins` remain exactly **1.86.0**, from the official npm
registry. Upstream paired 1.78.0; the matching 1.86.0 pair passed the actual Bun
CLI and tooling typechecks. The JavaScript plugin API remains alpha. Review and
upgrade the pair together. The seven Effect production files were inspected
before execution: imports are restricted to `@oxlint/plugins` and local AST
helpers, with no filesystem/network/process execution or dynamic evaluation.
This is a source review, not a comprehensive security audit.

The Effect plugin adds syntactic checks and introduces no Effect runtime
library. Its five findings were ordinary literal ternary branches; equivalent
native `if`/`switch` statements resolve them without starting an Effect migration.
Routing experiments, external worktrees and benchmark policies were not changed.

Only `lib/**/*.ts` and `lib/**/*.tsx` are covered. Generated fixtures, snapshots,
dist, dependencies, vendored tooling and agent tooling stay excluded. Tests run
in their existing harness; no upstream test accidentally enters Bun discovery.

## Counts and reviewed changes

The before run uses PR #2817 head `b8824d359f1c0afba8d3c989d0724bd5d550d3d5`
with the full configuration. The after run uses production source revision
`2d57cee` and the same configuration. Both checked **453 files** under Bun 1.3.14,
Oxlint 1.86.0, on 2026-10-02. These observations are not an error ceiling or a
snapshot assertion. See [machine-readable counts](anti-slop-full-counts.json).

| Rule | Before | First pass | Current |
| --- | ---: | ---: | ---: |
| `anti-slop/no-array-filter-map` | 14 | 0 | 0 |
| `anti-slop/no-reduce-accumulator-copy` | 0 | 0 | 0 |
| `anti-slop/no-chained-type-assertions` | 7 | 7 | 7 |
| `anti-slop/no-conditional-empty-object-spread` | 59 | 57 | 43 |
| `anti-slop/no-known-value-widening` | 95 | 95 | 95 |
| `anti-slop/no-module-mocking` | 0 | 0 | 0 |
| `anti-slop/no-object-parameters` | 1 | 1 | 1 |
| `anti-slop/no-reflect-apply` | 0 | 0 | 0 |
| `anti-slop/no-reflect-get` | 0 | 0 | 0 |
| `anti-slop/no-runtime-typeof` | 254 | 254 | 254 |
| `anti-slop/no-unsafe-dictionary-type` | 62 | 62 | 62 |
| `anti-slop/no-shape-in-symbol-names` | 15 | 0 | 0 |
| `anti-slop/no-unknown-parameters` | 24 | 24 | 24 |
| `anti-slop/no-unknown-returns` | 4 | 4 | 4 |
| `anti-slop/no-unknown-type-aliases` | 0 | 0 | 0 |
| `anti-slop/no-widen-then-assert` | 0 | 0 | 0 |
| `anti-slop/require-readable-spacing` | 6976 | 0 | 0 |
| `anti-slop/require-safety-comment-for-type-assertion` | 442 | 425 | 361 |
| `anti-slop-effect/no-manual-effect-error-tag` | 0 | 0 | 0 |
| `anti-slop-effect/no-manual-tag-comparison` | 0 | 0 | 0 |
| `anti-slop-effect/no-manual-tagged-construction` | 0 | 0 | 0 |
| `anti-slop-effect/no-service-constructor-imports` | 0 | 0 | 0 |
| `anti-slop-effect/prefer-effect-match` | 5 | 0 | 0 |
| `oxc/no-accumulating-spread` | 0 | 0 | 0 |

**Total: 7,958 → 851 errors.** The commits separate mechanical spacing,
compiler-checked assertion removal, narrow exceptions, and behavioral rewrites.
The 376-file spacing commit changes whitespace only. Of 377 changed production
files, **354 emit identical minified JavaScript** against the base; the remaining
23 contain the reviewed behavioral transformations below. This is an emission
comparison, not a proof of semantic equivalence. See
[per-file emission results](anti-slop-full-emission.json).

- Remove 16 redundant assertions where the compiler already establishes the
  asserted type. Keep an explicit existing `HighDensityRoute` annotation where
  optional route members must remain available. A typed `Rect[]` callback
  removes one additional literal assertion.
- Resolve all 14 array filter/map findings with reviewed `flatMap` transformations
  or string-key deduplication using `Set`. Preserve predicates, original route
  indexes, duplicate policy, object identity, and order. In the planar face
  counter, retain `findIdx` for every intersection because it registers vertices
  even when a later segment predicate rejects the intersection.
- Build two optional route properties with explicit conditionals. Metadata and
  jumpers stay absent when omitted; present properties keep their insertion order
  and metadata identity. Assigning `undefined` would change that contract.
- Replace the five matching literal ternaries with native branches, retaining
  fanout directions, top/bottom/transition dash styles, debugger status colors,
  progress text and capacity-editor labels.

The fused callbacks consume the project's ordinary geometry/route data. These
changes do not claim equivalent callback timing for arbitrary side-effectful
getters, proxies, or externally monkey-patched array methods. No routing speed,
solve rate or DRC quality improvement is inferred from the lint results.

The continuation from `fc68d2b` resolves another **78 diagnostics** in three
reviewable commits: 64 assertions and 14 conditional spreads. All 24 policies
stay enabled; no suppression was added. See [follow-up review and decisions](anti-slop-full-follow-up.md)
and [the verification record](anti-slop-full-follow-up.json). The first-pass
929-error checkpoint remains in the counts alongside the original baseline.

## Narrow exceptions and visible remaining work

[The exception inventory](anti-slop-full-exceptions.json) lists every one of the
**25** rule-specific, next-line exceptions with its reason and target location:

- **15 shape-name findings** are public SRJ/Circuit JSON keys (`shape`,
  `hole_shape`, `pad_shape`) or the exported `preloadedTraceShapeCount` statistic.
  Their spelling is part of existing wire/consumer contracts. The symbol rule
  remains active and integration tests prove it rejects an unrelated bad name.
- **10 spacing findings** occur at leading semicolon guards for automatic
  semicolon insertion. Biome removes the blank line requested by the upstream
  spacing fixer at those locations. The exception keeps the guard and both
  tools active; it suppresses only spacing, not any assertion on the same line.

[The remaining diagnostic inventory](anti-slop-full-remaining.json) records all
**851** errors with rule, exact file/line/column, UTF-8 byte span, expression excerpt
and message. Its triage categories are follow-up queues, not claims that every
finding is safe, inevitable, or a false positive. Nothing in that inventory is
suppressed. The main categories require separate contract and behavior review:

- **361 safety-comment findings** and **seven retained chained assertions**.
  Several chained casts involve external solver interfaces, a power-expander
  schema mismatch, validated cache data, geometry types or a keyboard/mouse
  adapter. Their exact contracts are discussed in [the earlier fixes](anti-slop-fixes.md).
  No unproven `SAFETY:` comments, cast splitting, or `any` laundering was added.
- **254 runtime typeof findings**, including untrusted HTTP/cache and DRC payload
  guards, optional external solver methods, and polymorphic debug serialization.
  Removing checks to satisfy a syntactic ban would alter accepted inputs or
  failures. These checks remain visible rather than receiving a blanket exception.
- **95 known-value widening findings**, including explicitly annotated anonymous
  return contracts such as `getMidpoint` and solver output records. The rule is
  syntactic and can flag a precise existing annotation. Do not remove a public
  annotation or invent a one-use wrapper type solely to hide a finding.
- **62 broad dictionaries**, **24 unknown parameters**, **four unknown returns**
  and **one object parameter**. Debug serializers and recursive solver inspection
  legitimately inspect heterogeneous values, while some adapters need stronger
  owner contracts. They require individual review; changing public inputs to
  arbitrary narrow types would falsely promise validation.
- **43 conditional empty-object spreads** remain as rewrite backlog. Optional
  field absence, key order and construction timing need tests before replacement.
  These are not classified as unavoidable conflicts.

## Verification

Heavy local validation used the existing shared benchmark wrapper and lock,
serially, without modifying other checkouts or dependencies. Checks completed:

- Repository `tsc --noEmit`, tooling `tsc --project tsconfig.anti-slop.json`,
  the existing ESM/declaration build, and repository Biome format check.
- **38 focused tests / 485 assertions**, including existing routing/SVG snapshots,
  DRC adapters/baselines, topology restoration, jumpers, layer transitions and
  simplification. Two new tests cover invalid/empty node pitch, duplicate
  assignable via keys, unchanged obstacle inputs, optional field omission,
  metadata identity, copied jumper endpoints and property insertion order.
- A further capacity-visualization regression (**one test / six assertions**)
  covers rect omission plus top/bottom/transition colors, points and dash styles.
  The actual graphics object and white-background SVG match the base byte for
  byte on this fixture (SVG SHA-256
  `0faf1d4f633114dfd09c0bd4b89975141b1570affdb6119510f7c3b5b4b9a3ce`).
- Actual Bun CLI integration: **five tests / 124 assertions**. Deliberately bad
  examples trigger every one of the 24 rules at error severity and exit 1.
  Legitimate geometry, owned accumulation, const assertions and the two narrow
  exception forms pass. Ignored paths, missing config/plugin failures, exact
  dependency pins and all 39 vendor file hashes are verified. A regression runs
  the actual Bash pipeline and verifies that both rule errors and missing-config
  errors retain exit 1 through a Bash pipeline. A further regression generates
  1,000 diagnostics, verifies complete direct-file output beyond 64 KiB, checks
  the summary counts, and rejects a truncated JSON artifact.
- Full lint JSON confirms every remaining diagnostic is an error and the command
  exits 1. No original snapshot or fixture was updated.

The GitHub advisory check runs the same CLI under CI Bun 1.3.8. Follow the current
PR's exact head and step outcomes rather than treating its advisory job conclusion
as proof of a clean lint run. Normal Bun test shards retain their existing behavior.
