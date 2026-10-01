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
  postRoutingOptimization: options,
})
router.solve()
const report = router.getPostRoutingOptimizationResult()
```

The forest proposal (`postRoutingForestSolver`) inserts one physical branch per
step with same-layer forest preplanning. `postRoutingOptimizationSolver` then
validates the whole board and objective before atomic acceptance or rollback.
This baseline branch has no A Pipeline9 stage or `dynamicNetTreeRouting` option.
It shares the low-level physical search helpers with the A comparison branch.

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
original boards and malformed ownership still throw. Unsupported geometry or missing
physical facts return `status: "unsupported"`, `validationStatus: "unsupported"`,
unchanged copper and diagnostics; this does not certify the original board.
Exhausted search, failed
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

## Independent B comparison

This PR is based directly on main and enables only the forest-first transaction
through `postRoutingOptimization`. The stacked comparison is #2806, based on
A (#2804). B still uses common physical branch-search helpers for connections
remaining after forest planning; it does not invoke the A Pipeline9 pass. This
is a pass-level comparison, not an assertion of disjoint algorithms.

The full four-arm regression on #2806 uses the same inputs, seed, constraints,
objective and total extra search budgets. This branch repeats baseline and B,
and their output hashes and metrics match those arms from the combined branch.
A+B budgets are split equally across its passes. A rejected candidate reports
its diagnostics and retains the exact input copper.

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

For native stage capture, use `PipelineStageDebugRunner` with the enabled
proposal and validation stages. `getRecordedGraphics()` supplies actual physical
branch events; `visualize()` supplies candidate or accepted/rolled-back copper.
The existing SRJ23 snapshot test renders the final SRJ directly so completed
copper remains visible when an optional phase returns unsupported or rejected.

## Authoritative pad metadata

Some Circuit JSON to SRJ producers omit plating and drill facts. Pass the original
source as `postRoutingSourceCircuitJson`, or call
`restorePostRoutingPadMetadata(srj, circuitJson)` before the standalone phase.
The adapter requires an exact `circuitJsonMetadata` pad ID and matching port,
land geometry, rotation and layers. It adds source-backed plating/drill facts to
a copy, never infers plating from multilayer geometry, and rejects conflicting
explicit facts. Missing evidence remains unsupported. Slots, offset drills and
rounded or unknown lands remain explicitly unsupported. Via dimensions use
Pipeline9's canonical `getViaDimensions` defaults and alias precedence.

`validationStatus: "validated"` means the supported continuous geometry contract
(and any supplied additional checker) passed. It does not assert a complete
KiCad/manufacturing DRC. In A+B, an unsupported or rejected A still lets B report
independently on preserved copper. Invalid original copper and malformed source
identity throw and stop the pipeline, since there is no valid baseline to replace.

## Public PR benchmark profile

This comparison branch explicitly opts the benchmark runner into B in
`scripts/benchmark/pipeline9-post-routing-profile.ts`. Product constructors remain
disabled by default. `/benchmark --pipeline 9 --dataset 01 --effort 1
--concurrency 2 --sample-timeout 120s` uses the existing comment dispatcher and
paired runner without any workflow/permission changes. A and B compare with main;
A+B compares with its A branch base. The checked-in profile chooses one mutable
whole net by terminal count, preserves preloads, and declares a 300,000 expansion /
5,000 ms total extra budget, split equally across A+B. Objectives allow no copper
length or bend increase and at most one changed net.

An unsupported post-phase has `postRoutingBenchmark.pipelineSolved` recorded but
`eligible: false`, no scored via count, and an explicit error in the public report.
The profile is limited to explicit `dataset01` and `srj18` Pipeline9 tasks;
other benchmark tasks retain their original behavior. The A-only branch reports
its transaction through `getPostRoutingOptimizationResult()`; the stacked branch
uses `getDynamicNetTreeRoutingResult()` for A and the last-transaction getter for B.
Only phase-validated outputs proceed to native relaxed-DRC scoring. The existing
runner uses via *entries*; the phase reports unique physical via sites and copper
union length separately. The unchanged workflow does not fix random seeds or
force identical routed baselines between revisions. Its same-machine comparison
is an observed integration benchmark; isolated saved-baseline replay is needed
to identify the incremental phase effect. Search and validation times and phase
diagnostics are included in JSON. No universal improvement is asserted.
