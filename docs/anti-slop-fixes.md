# First anti-slop assertion fixes

This follow-up to the warning-only setup changes types at existing boundaries.
It reduces the baseline from **27 to 7 warnings** across the same 453 library
files, with zero lint errors. All warnings are from
`anti-slop/no-chained-type-assertions`; the other three enabled rules still
report zero. No configuration changes or suppressions are involved.

[The before/after inventory](anti-slop-fixes-inventory.json) records every one of
the 27 original locations, its classification, the action and rationale, and
the current locations of all seven retained warnings. The original
[setup baseline](anti-slop-baseline.json) remains a dated observation.

## Changes to review

| Original warnings | Contract issue | Change |
| --- | --- | --- |
| 17: Pipeline 9 joint DRC repair (13), Pipeline 7 evaluator (2), Pipeline 9 evaluator (2) | Native Circuit JSON interfaces have no index signature, while repair APIs accept `Record<string, unknown>`. | Define the producer's discriminated error union as a shallow `Readonly` mapped field view. Pass its arrays directly through the existing repair adapters. |
| 1: multi-section optimizer | The factory creates `HyperPortPointPathingSolver`, but its return type and stored active solver claimed the different child `PortPointPathingSolver` class. | Use the actual supervisor type in both places and remove the assertion. |
| 1: permutations | The array-subtype generic promised to preserve tuple positions or arbitrary array subtypes, including for shorter recursive inputs and the empty base case. | Use an element generic: `(ar: readonly T[]): T[][]`. Preserve enumeration order, duplicates, object references and the empty permutation. |
| 1: Pipeline 10 fanout | The installed fanout solver already satisfies the imported `BaseSolver` contract. | Assign it directly and let TypeScript check compatibility. |

The DRC change keeps concrete error discriminants and required fields. Native
interface values remain assignable to the producer view. A mapped object view
allows TypeScript's implicit record assignability without an explicit unknown
index signature, a broad record-only error type, a runtime clone or an assertion.
Its top-level fields are readonly through this view; nested arrays retain their
existing types. It does not freeze objects, validate arbitrary records or prove
that an arbitrary dictionary key exists. Existing repair metadata checks remain
in place. This is a type-system interoperability fix, not evidence that the
previous native DRC values were invalid at runtime.

The inaccurate permutation and supervisor types concealed real contract
differences. The DRC and fanout changes remove unnecessary boundary casts.
Inspection found no false positive: each reported expression really was a
chained assertion, although the syntax rule cannot decide whether it is justified.

## Seven warnings kept visible

| Location | Reason to retain in this change |
| --- | --- |
| `constructMiddlePointsWithViaPositions.ts:71` | The working array starts nullable. Via placement and gap interpolation fill every position before return, but TypeScript does not prove that loop invariant. Adding a validation/copy pass to each candidate just to remove the warning would change its work; allocating a typed sparse array would hide the same invariant. The existing assertion and warning remain. |
| `HdCache2Client.ts:431` | Remote route points, vias and the fields consumed by the layer-transition helper are checked first. The full route assertion still overstates the established contract at that point: jumpers are checked afterward. A proper refinement should express the already-validated subset and preserve rejection behavior; it needs more than changing cast syntax. The HTTP layer-transition regression remains passing. |
| `PowerTraceExpansionSolver.ts:20` | The external expander requires a `layer` on each connection point. Local valid multilayer points use `layers` and forbid simultaneous `layer`. Keep the existing adapter rather than rewriting PCB schema data or choosing an arbitrary layer. This remains a real dependency contract mismatch, not proof of complete compatibility. |
| `prepare-pipeline7-power-trace-expansion-input.ts:103` | The same input mismatch reaches `ConnectionNameResolver`. Its current default reads logical point/port identity; physical position aliases, which read layers, are opt-in and this caller does not enable them. A shared narrow input contract belongs in the dependency, rather than duplicated schema conversion here. |
| `AutoroutingPipelineSolver10_BgaFanout.ts:380` | The local autorouting child lacks the external `BaseSolver` members `_setupDone`, `setup`, `_setup` and `getOutput`. The stage drives the concrete child explicitly; the active pointer still claims the broader external contract. Unifying that lifecycle contract requires separate design. |
| `TraceSimplificationStageSolver.ts:43` | The simplification child has the same external `BaseSolver` mismatch. Its stage also drives the concrete child explicitly. Keep the warning until the shared solver contract can be fixed without introducing a cosmetic wrapper. |
| `CapacityNodeEditor.tsx:611` | A keyboard event is asserted to be a mouse event. Placement modes read `clientX/clientY`, which a keyboard event does not have, so this can produce invalid coordinates. A keyboard placement/focus policy needs an explicit behavior decision. Widening the handler type would merely conceal the issue. |

These are recorded tradeoffs and unresolved contracts, not lint exemptions. They
remain in normal command output. No geometry names, `shape` fields, routing
parameters, error ownership rules or algorithms are changed. A lower warning
count does not establish routing speed, solve rate or DRC quality.

## Verification

- Normal TypeScript check, the separate anti-slop tooling check, Biome format
  check and package build pass.
- Two new tests exercise readonly and heterogeneous permutation inputs and
  native typed DRC errors through repair metadata/geometry handling.
- Existing relaxed DRC parity, joint repair metadata, baseline filtering,
  via centers, multi-section routing, limited candidate routing, bus/obstacle
  schema and HTTP layer-transition tests pass with the original snapshots.
- The actual Bun CLI integration still catches all four selected warning
  examples, accepts legitimate geometry/schema patterns, checks scope and
  exclusions, and fails for broken config/plugin loading.
- Bun's TypeScript transpiler produces identical minified JavaScript for all
  seven changed production files compared with setup commit
  `705cfee7a78e66396cb7d1ebf4c3edbb85ab0733`. This checks type erasure for these
  edits, alongside the behavior tests; it is not a routing benchmark.

Local heavy checks use the existing shared benchmark lock. The PR is stacked on
the unmerged setup branch. The all-PR Bun Test workflow runs its nine shards;
main-only build/type/format/advisory workflows do not trigger on this stack base,
so their applicable local commands are verified explicitly.
