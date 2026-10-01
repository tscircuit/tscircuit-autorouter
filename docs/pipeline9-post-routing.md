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
