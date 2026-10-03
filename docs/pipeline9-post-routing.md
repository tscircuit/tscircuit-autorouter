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

The validator supports 2–10 canonical copper layers, wires, contiguous through or
blind/buried via spans, rotated rectangles, capsules, circles and exact rounded
rectangles. Pad interlayer bridges require explicit plating and independent drill
geometry. Non-plated circular holes require explicit source-ID/obstacle mappings;
unknown ID-less obstacles are never inferred to be holes. Plated-land traversal
markers require source identity, owner, endpoint containment and a proven span.
Differential pairs, buses, planes, jumpers, slotted/offset drills, polygons,
external constraints and ambiguous ownership require dedicated adapters. Invalid
original boards and malformed ownership still throw. Unsupported geometry or missing
physical facts return `status: "unsupported"`, `validationStatus: "unsupported"`,
unchanged copper and diagnostics; this does not certify the original board.
Exhausted search, failed
candidate validation, or no objective improvement return the original output.
An optional additional native/manufacturing checker validates isolated copies.
Copper length is a same-owner, same-layer collinear union. Via sites include
physical span and dimensions: duplicate representations of one barrel count once,
while distinct stacked blind/buried barrels count separately. Pass the SRJ as the
third metric argument for multilayer copper. Verified plated-land traversal adds
no new barrel or routed-wire length. These metrics do not imply universal improvement or manufacturing signoff.

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

## Authoritative pad metadata

Some Circuit JSON to SRJ producers omit plating and drill facts. Pass the original
source as `postRoutingSourceCircuitJson`, or call
`restorePostRoutingPadMetadata(srj, circuitJson)` before the standalone phase.
The adapter requires an exact pad ID from `circuitJsonMetadata` or the producer's
own-pad `connectedTo[0]` record and a verified land envelope/layer span. It checks
PCB-port identity and corrects the known legacy source-port migration only when
the exact source PCB port is already in that pad's input alias block. It preserves
unassigned pads and never invents ports or electrical ownership. Source rounded
and capsule geometry is restored inside the verified original envelope; that
conservative envelope is also retained during search, including via-in-pad
exclusion. Missing source pads or unmapped source holes,
unsupported geometry and conflicting explicit facts cannot be certified.

For ID-less non-plated holes, pass an explicit `pcb_hole_id → obstacle index` map
as the third argument, or `postRoutingSourceHoleObstacleIndices` alongside the
Pipeline9 source. The source component and exact drill geometry must agree;
coordinates alone cannot assign ownership or plating. The original SRJ, endpoint
constraints and routed copper stay immutable. Slots and offset drills remain
unsupported. Via dimensions use
Pipeline9's canonical `getViaDimensions` defaults and alias precedence.

`validationStatus: "validated"` means the supported continuous geometry contract
(and any supplied additional checker) passed. It does not assert a complete
KiCad/manufacturing DRC. In A+B, an unsupported or rejected A still lets B report
independently on preserved copper. Invalid original copper and malformed source
identity throw and stop the pipeline, since there is no valid baseline to replace.

## Public PR benchmark profile

This comparison branch explicitly opts the benchmark runner into A in
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

## Physical layer and rule contract

A via's signal `from_layer`/`to_layer` does not define its whole physical barrel.
When `allowBlindAndBuriedVias` is absent or false, every via occupies every board
copper layer, even a top-to-inner1 transition. Under an explicit blind/buried
policy, the default is the inclusive endpoint span; `via.layers` may specify a
wider contiguous span. Unknown/aliased layer names, missing endpoints, duplicate
layers and noncontiguous spans fail loudly. New vias are checked on every occupied
layer and emitted with their physical span. Drill spacing uses independent drill
centers/spans, never an oval land's capsule centerline.

Explicit input rules are retained. Unspecified trace clearance follows Pipeline9's
0.1 mm validation contract (a supplied obstacle margin remains binding); unspecified
board-edge clearance is zero. Foreign via/pad clearance is the maximum of 0.1 mm,
the supplied via/pad rule and the obstacle margin. The via-hole gap defaults to 0.1 mm;
plated-hole drill spacing uses its separate declared rule, default zero physical
hole overlap. NPTH-to-wire clearance defaults to the native checker's 0.2 mm.
Via-in-pad is prohibited by default on the whole board; permission requires
`allowViaInPad: true`. These are routing/checker defaults,
not recovered KiCad fabrication rules. Provide the complete additional checker
through `validate` for requirements beyond this geometry model.

For strict via reduction, use `objective.priorities: ["viaSites"]`. Length/bend
allowances are explicit tradeoffs, never an inferred user requirement. An unchanged
via count is rejected even if another metric improves. Multiple requested nets
form one atomic transaction; any failed proposal restores all original copper.
A caller may run separate explicit net transactions, checking its total time,
length and changed-net budgets between calls. Validation time is additional to
search time. Dense grids are capped at one million cells and via search at forty
million states; finer grids/larger stacks can exhaust memory or search budgets.

Original physically invalid copper still throws. Source restoration can therefore
expose a defect that the relaxed Pipeline9 benchmark checker did not test. It does
not repair that baseline automatically. Any comparison using a separately repaired
reference must identify that repair and cannot establish fresh default-pipeline
quality. No universal improvement, complete KiCad DRC or manufacturing signoff is
asserted.
