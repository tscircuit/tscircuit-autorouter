# Pipeline9 post-routing transactions

These opt-in stages run after `powerTraceExpansionSolver`. No option, or
`enabled: false`, leaves the existing stage list and serialized output unchanged.

```ts
const options = {
  enabled: true,
  nets: [{ net: "signal", maxNewVias: 0, maxNewViasPerBranch: 0 }],
  objective: {
    priorities: ["viaSites", "copperLength", "bends"],
    maxCopperLengthIncrease: 0,
    maxBendIncrease: 0,
    maxChangedNets: 1,
  },
  search: {
    gridStep: 0.25, viaCost: 3, bendCost: 0.05,
    maxExpansions: 300_000, maxMilliseconds: 5_000,
  },
} satisfies PostRoutingOptimizationOptions
const router = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
  dynamicNetTreeRouting: options,
})
router.solve()
const report = router.getPostRoutingOptimizationResult()
```

The tree proposal (`dynamicNetTreeSolver`) inserts one physical branch per step.
The next stage (`dynamicNetTreeValidationSolver`) independently validates the
whole board and objective, then accepts or reports atomic rollback. The tree
profile does not enable `componentPlanning`; the shared-forest post-phase is a
separate comparison arm. Both use the same low-level physical search helpers.

`optimizePostRouting({ srj, traces, traceOwners }, options)` is the callable
standalone transaction. `PostRoutingNetTreeSolver` and
`PostRoutingOptimizationSolver` expose the same two stages. No experimental
harness or specific board is required. Search time budgets count active search,
excluding pauses between recorded steps; validation time is reported separately.
A single branch search can consume the remaining budget before yielding.

Unselected copper and finalized fixed preloads are retained exactly, including
explicit native replacements made before this phase. Rules, pad geometry, layer
ownership and whole-net terminal identities come from the immutable physical
input. Each output alias must resolve to exactly one explicit whole-net owner;
ambiguous merged roots require an adapter and fail explicitly. The report lists
changed nets, trace IDs, before/after/candidate metrics, search budgets and
validation/rejection diagnostics. Returned results and snapshot views are copies.

The conservative validator currently supports two ordinary layers, wires,
through vias, rectangular/circular lands with explicit ownership, and explicit
plating/drill metadata. Differential pairs, buses, planes, jumpers, blind vias,
external constraints and ambiguous ownership require dedicated adapters. Invalid
original boards and unsupported geometry throw; exhausted search, failed
candidate validation, or no objective improvement return the original output.
An optional additional native/manufacturing checker validates isolated copies.
Physical copper-length union, unique via sites and vertex bends are routing
metrics; they do not imply universal improvement or manufacturing signoff.

`visualize()`/`preview()` show current physical copper. `getRecordedGraphics()`
contains actual branch events with native GraphicsObject step numbers. The
PipelineStageDebugRunner uses that hook for per-step PNGs and the current view
for the stage overview. The validation stage records candidate and accepted or
rolled-back output. No schematic animation stands in for routing events.

Based on upstream 0.0.951 / `911963b2f539f38140386cb0073332053b2d4582`.
The existing repair03 dependency remains pinned to `ccad3906...`; historical
private-board results on 0.0.941 plus local repair `cc5068...` do not establish
fresh Pipeline9 integration quality. Independent draft #2800 is not a dependency.
Original draft #2803 is preserved as prior combined work. No private fixtures or
images are included here.

## Four comparison arms

`postRoutingOptimization: options` appends `postRoutingForestSolver` and
`postRoutingOptimizationSolver`. It enables `zero-via-forest` planning:
same-layer physical components join before new vias are allocated. Enable this
alone for B, `dynamicNetTreeRouting` alone for A, both for A+B, or neither for
baseline. In A+B, B starts from A's accepted board or its unchanged rollback
board. A rejection in B retains A's accepted copper, never the earlier baseline.

B uses the common dynamic physical branch-search helpers for connections left
after forest planning. B-only does not enable A's Pipeline9 pass. Consequently
this is a pass-level comparison of tree reconstruction, forest-first
reconstruction, and their sequence, not a disjoint-algorithm ablation. A+B may
repeat useful work or yield no additional improvement. Give each arm the same
total extra search budget by dividing it across enabled passes; individual
options expose their own budgets. Original constraints remain hard gates.
`getDynamicNetTreeRoutingResult()` reports A separately;
`getPostRoutingOptimizationResult()` reports the last enabled transaction.

## Fresh generic controls

The four-arm regression uses three point-terminal boards with three signal
endpoints and one untouched straight net, translated to different coordinates
and with required widths 0.3, 0.4 and 0.6 mm. Seed 1, effort 0.1, no cache,
identical rules/objectives/grid costs, and a total extra budget of 300,000
expansions / 10,000 ms per arm (split equally across A+B) are explicit in the test.
Every final result passes continuous physical connectivity/rule validation and
native `@tscircuit/checks` validation. This is not a fresh KiCad benchmark.

| Width / offset | Baseline length / bends | A | B | A+B |
| --- | --- | --- | --- | --- |
| 0.3 / 0 | 35.099 / 25 | 30.287 / 8 | 32.358 / 9 | 30.287 / 8 |
| 0.4 / -20 | 32.071 / 1 | 30.000 / 0 | 32.071 / 1 | 30.000 / 0 |
| 0.6 / 50 | 33.121 / 16 | 30.816 / 9 | 32.887 / 10 | 30.816 / 9 |

Lengths are mm of physical copper union. All arms have zero via sites, zero
native errors and zero physical opens/rule errors. B rejects the middle control;
B after A rejects all three and retains A's accepted copper. These narrow controls
do not establish an advantage for stacking or predict production-board results.
The test prints complete hashes, diagnostics and measured runtime, rather than
asserting a universal win. Existing pad/via/ownership/clearance regressions cover
additional supported geometry separately.

Capture the exact current checkout with:

```sh
bun scripts/capture-post-routing-stages.ts A+B /tmp/post-routing-captures graphics
```

The manifest records the Git head, immutable generic input, arm, seed, options,
actual stage iterations, diagnostics, output and native recorded graphics paths.
Omit `graphics` to let PipelineStageDebugRunner also render SVG/PNG stage views.
B-only branches reject requests for A rather than silently displaying B as A.
