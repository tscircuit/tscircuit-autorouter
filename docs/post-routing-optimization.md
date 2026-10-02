# Opt-in post-routing optimization

`optimizePostRouting` is a standalone final phase. Call it **after** the router
and its repair/simplification/width-expansion stages have completed. Existing
pipelines do not call it automatically. It does not need short-first routing,
replace a repair dependency, or rewrite the routing pipeline.

```ts
import { optimizePostRouting } from "@tscircuit/capacity-autorouter"

router.solve()
const routed = router.getOutputSimpleRouteJson()
const optimized = optimizePostRouting(
  {
    srj: originalSrj, // Original rules and whole-net connections
    traces: routed.traces!, // Complete output, including retained preloads
    traceOwners, // Explicit Map<output connection name, original whole-net name>
  },
  {
    enabled: true,
    nets: [{
      net: "signal",
      maxNewVias: 2,
      maxNewViasPerBranch: 2,
      componentPlanning: "zero-via-forest",
    }],
    objective: {
      priorities: ["viaSites", "copperLength", "bends"],
      maxCopperLengthIncrease: 0,
      maxBendIncrease: 0,
      maxChangedNets: 1,
    },
    search: {
      gridStep: 0.2,
      viaCost: 3,
      bendCost: 0.05,
      maxExpansions: 500_000,
      maxMilliseconds: 5_000,
    },
    // Optional additional synchronous native/manufacturing checker:
    // validate: ({ srj, traces, traceOwners }) => ({ valid, diagnostics }),
  },
)
// Both rejection and disabled status return a clone of the exact routed traces.
const finalSrj = { ...routed, traces: optimized.traces }
console.log(optimized.status, optimized.changedNets, optimized.changes)
console.log(optimized.before, optimized.after, optimized.diagnostics)
```

Resolve output aliases to original nets from the router's actual connection
metadata. Do not infer ownership from prefixes, coordinates or similar names.
The phase adds root-name identity mappings and rejects conflicting ones.
`originalSrj` must describe ordinary whole nets. It is not a point-pair problem.

## Transaction and objective

One explicit ordered net group is one atomic transaction. Selected mutable
traces are removed locally; all other copper is fixed. Input `srj.traces` are
protected even on selected nets and must still occur exactly in routed output.
Previously generated branches are protected by selection/identity, not prefixes.
No input object, map, pad, terminal, outline, rule or fixed trace is edited.
Unaffected trace objects compare exactly, including geometry, metadata and order.
Selected nets can be substantially rerouted; the locality limit is the named nets,
not a maximum distance moved. Use small groups to inspect each replacement.

Physical connected components are recomputed after each branch. Search targets
existing copper and branch interiors rather than frozen Euclidean terminal pairs.
Optional `zero-via-forest` first joins reachable same-layer components with
multi-source wavefronts, conserving transitions for remaining component obligations.
Without that option, the tree grows from the first terminal's component.

The declared priorities are minimized lexicographically. At least one must
strictly improve before acceptance; the first differing priority decides.
Length and bend increases have explicit **absolute** budgets (mm / bends).
The example permits neither to increase. Other policies can allow via/length
tradeoffs. There is no implicit percentage policy, weighted score, automatic
portfolio search, or universal quality guarantee.

New-via caps count newly inserted transitions per net/branch; fixed/preloaded
sites do not consume that allocation. Whole-board metrics include both.
The shared expansion/time budget covers the net group, including connector and
forest work. The grid is capped at 1,000,000 two-layer cells and each search at
40,000,000 direction/via states. Timing is cooperative (checked during work and
at transaction completion), not a process watchdog. Input copying, topology
construction and validation can take additional time. Use an outer worker or
process deadline for strict wall/RSS limits. No statistical runtime claim is made.

`before`/`after` describe returned output. `candidateMetrics` describes a completed
candidate even if it is rejected. `changes` provides per-net before/after metrics
and removed/added trace IDs only for an accepted transaction. `attempts` reports
search completion, errors, expansions, components and elapsed time. Search and
validation milliseconds are recorded separately. A search failure, budget stop,
validation failure or objective rejection reports diagnostics and returns the
entire original trace list; partial groups never escape as accepted output.

## Validation and limits

Original and candidate boards must pass continuous geometry, foreign clearance,
width/via dimensions, edge/drill spacing and same-net physical connectivity checks.
Existing selected-net wire widths and via dimensions are preserved. Mixed widths
or via sizes on a selected mutable net require a future explicit adapter and throw.
Vias must explicitly occupy coincident wire endpoints on both layers.
Physical metrics union overlapping collinear same-net/layer segments, deduplicate
via sites (1e-9 mm keys), and count noncollinear interior wire bends. These are
routing metrics, not native CAD serialization or exposed-bend measurements.

The SRJ adapter supports top/bottom wires, through vias, rotated rectangular and
circular pads, and rectangular or polygon board outlines. Multilayer pads require
explicit `isPlated` metadata. Plated pads must span both layers and supply a
positive `holeDiameter`; IDs never establish plating or drill size. The exported
`PostRoutingPhysicalInput` / `PostRoutingObstacle` types describe these extensions.
Missing plating classification and unsupported drilled-pad geometry throw.
Unsupported planes, NPTHs, assignable-net
obstacles, off-board/external connections, constrained terminal-via hints,
differential pairs, buses, jumpers and blind/buried vias throw. Original inputs
must already be valid. This is a quality phase, not a repair for invalid boards.

The built-in checker covers this conservative SRJ subset. Attach an independent
native/manufacturing checker through `validate` when downstream design rules need
it. The hook receives isolated copies of both boards and cannot alter output.
An original-board rejection/exception or unsupported input throws; candidate hook
rejections/exceptions report rollback. Internal invariant errors throw explicitly.
Neither an SRJ pass nor `solved: true` guarantees native manufacturing validity.

## Generic regression evidence

Run `bun test tests/dynamic-net-tree tests/post-routing --timeout 9999999`.
Generic controls cover three boards with different coordinates/widths, a physical
shared-via allocation failure and forest solution, foreign barriers/aliases,
preloaded components, whole-net caps, physical validation negatives, deterministic
output, zero improvement/disabled output and atomic rollback after a second-net
failure or additional checker failure. No private board or experiment harness is
needed. These fresh integration tests do not establish full-board benchmark gains
for arbitrary inputs or reproduce historical private manufacturing measurements.

The implementation lives in two small folders plus public exports. It uses SRJ
types and one segment-distance utility; it has no dependency on a specific
pipeline, cache, experimental harness, repair solver, or board identity. This
keeps later extraction possible without creating another repository now.
