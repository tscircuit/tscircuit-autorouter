# Initial anti-slop adoption

This page records the initial four-warning setup on 2026-10-02. The subsequent
user-approved full-rule configuration and current behavior are documented in
[Full anti-slop adoption](anti-slop-full.md). The policy, counts and verification
below describe the initial setup rather than the current branch.

The initial `bun run lint:anti-slop` command runs from the repository root under Bun
explicitly (`bun --bun`), so TypeScript config/plugin loading does not depend on
the machine's Node version. This is a separate advisory command alongside the
existing Biome formatter, Bun tests, snapshots, build and type check.

## Initial policy

| Rule | Severity | Review concern |
| --- | --- | --- |
| `anti-slop/no-chained-type-assertions` | warning | Nested `as` or angle-bracket assertions discard type evidence; const-only chains remain allowed. |
| `anti-slop/no-widen-then-assert` | warning | A known value is widened in an immutable local binding and later asserted narrower. |
| `anti-slop/no-reduce-accumulator-copy` | warning | Non-spread copies of a growing reducer accumulator, such as `Object.assign({}, acc, item)`, `Array.from(acc)` or array `concat`/`slice`. |
| `oxc/no-accumulating-spread` | warning | Accumulating object/array spread in reducers or loops; complements the custom rule, which excludes spreads. |

The command targets `lib`, and the config applies these rules only to its TS/TSX
files. Generated fixtures, snapshots, dist, dependencies, agent tooling and
vendored tooling are excluded. Other default Oxlint categories are disabled;
this command adopts exactly these four rules. A normal run exits successfully
with warnings. Parse, config, plugin-loading or runtime failures still produce a
nonzero exit; there is no `|| true`, quiet mode, warning cap or autofix.

`no-shape-in-symbol-names` is explicitly off: PCB obstacles use legitimate `shape`
discriminants and geometry/schema names. Unknown/typeof bans, broad dictionary
policy, spacing mandates, safety-comment requirements and filter/map rewrites
are also off. The Effect plugin is not copied or enabled. No geometry fields or
routing implementation are renamed or rewritten by this setup.

## Baseline and triage

On `main` commit `911963b2f539f38140386cb0073332053b2d4582`, 2026-10-02, Bun
1.3.14 with Oxlint 1.86.0 checked **453 files** and produced **27 warnings, zero
errors**: 27 chained-assertion warnings and zero for each other selected rule.
[The baseline record](anti-slop-baseline.json) lists every location and its rule;
it is a dated observation, not a warning ceiling or a snapshot assertion.

Inspection found 13 warnings in `Pipeline9JointDrcRepairSolver` around DRC error
adapters, four in the Pipeline 7/9 relaxed DRC evaluators, and the remaining ten
around external solver adapters, power expansion input, remote cache route
validation, editor event handling, middle-point types, generic empty permutations
and multi-section pathing input. These are actual assertion chains, but the
syntax check does not establish whether each adapter is unsafe. Their warnings
remain visible; no baseline suppressions were added.

Review each warning against the boundary contract and tests before changing code.
Prefer retaining precise types or validating untrusted data once. If a particular
interop assertion is necessary, a future narrowly scoped exception should explain
its invariant and include regression coverage. Do not erase a diagnostic by
splitting a cast, adding `any`, renaming `shape`, or rewriting a reducer without
checking ownership and behavior.

## Limits and verification

These custom rules use syntax and lexical scope, not a TypeScript checker. The
widening rule tracks supported local immutable flows; it does not follow imported
contracts or cross-function data flow. The custom reducer rule does not fully
analyze named callbacks, indirect helpers or nested accumulator properties, and
array-method detection needs local array evidence. Zero warnings are not proof
that all type or quadratic-copy problems are absent. Warnings do not establish
routing speed, solve rate, DRC quality or any other routing metric.

- `bun run test:anti-slop` exercises the actual Bun CLI, all four warnings,
  warning exit behavior, locally owned mutation, item copying, const assertions,
  geometry `shape` schemas, allowed unknown/typeof/filter-map usage, ignored paths,
  non-lib scope, missing config/plugin failures and vendor/test boundaries.
- `bun run typecheck:anti-slop` checks config, copied production source and these
  tests separately without changing the normal repository typecheck scope.
- The `Anti-slop diagnostics` CI job uses Bun 1.3.8 and is initially advisory
  through job-level `continue-on-error`. Logs show full warnings and failures;
  its summary records step outcomes. A green overall advisory check can still
  contain a failed setup/integration step, so inspect the summary and logs.
  Existing required checks retain their normal behavior.

Oxlint's JS plugin API is [alpha](https://oxc.rs/docs/guide/usage/linter/js-plugins.html).
The exact matching `oxlint` and `@oxlint/plugins` 1.86.0 pins came from the official
npm registry, newer than upstream's 1.78.0 development pair, and are tested together.
The repository already disables Bun lockfile saving; this setup preserves that
choice and unrelated dependency ranges. Review both pins together when upgrading.
See [vendored provenance and license details](../tools/oxlint/anti-slop/UPSTREAM.md).
