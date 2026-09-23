# Node-local simplification experiment

## Decision

Keep the early shortcut pass opt-in (`enableNodeSimplification: true`) and disabled by default. Node-local work is technically feasible and reduces downstream work on surviving samples, but the enabled experiment introduced serious regressions. It is not ready to replace global simplification or become the default.

## Placement and scope

`Pipeline9RegularNodeSolver` runs an incremental `Pipeline9NodeSimplificationSolver` immediately after an ordinary node finishes routing, before force improvement and repair. The networked worker uses the same factory. Each shortcut solver sees only that node's routes and nearby obstacles. Endpoints, via locations, route metadata, and copper near the node boundary are preserved; proposed shortcuts also check the configured clearance and board outline.

Fixed-copper/B01 and regional fallback nodes are excluded. Global simplification is retained to isolate the benefit of early simplification. Grown routing nodes can overlap, so this does not eliminate global repair. Network parallel speedup and replacement of global simplification were not measured.

The default network solve policy and request shape remain unchanged. Opting in selects a separate policy (`ordinary_node_shortcuts_then_regional_without_fixed_copper_v2`) to avoid sharing cached solutions with ordinary routing. An enabled remote worker must support that policy.

```ts
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
  effort: 1,
  enableNodeSimplification: true,
})
solver.solve()
// The same option is available on AutoroutingPipelineSolver9_Networked.
```

## Dataset 18 benchmark

Command posted on draft PR #2703: `/benchmark --dataset 18`.

Main `eb7e607` and enabled experimental head `1c7c9dc` ran sequentially on the same 8-vCPU Blacksmith machine, effort 1, 16 scenarios, 360-second sample timeout. The final PR gates the experiment off by default; these numbers characterize the earlier enabled head, not default behavior at the final head.

[Full comparison and raw artifacts](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/35917400876).

| Metric | Main | Enabled experiment |
| --- | ---: | ---: |
| Completed / relaxed DRC passed | 16/16 | 12/16 |
| Timeouts | 0 | 0 |
| Failure-penalized P50 | 108.5 s | 183.6 s |
| Failure-penalized P95 | 345.6 s | 360.0 s |
| Average vias among solved boards | 223.88 | 214.25 |

The benchmark assigns failed samples their timeout for timing percentiles. Via averages compare different surviving boards and must not be interpreted as a routing-quality improvement.

A [second paired run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/35917098643/attempts/2) also completed only 12/16 with the experiment, versus 15/16 on main (one baseline timeout); P50 was 104.6 s versus 201.6 s. An earlier attempt was cancelled before reports were produced.

### Matched successful samples

On the 12 samples solved by both revisions in the clean comparison:

| Stage / measure | Main | Experiment | Change |
| --- | ---: | ---: | ---: |
| Force improvement, summed | 28.82 s | 19.63 s | -31.9% |
| Node repair, summed | 81.02 s | 54.86 s | -32.3% |
| Global simplification, summed | 132.26 s | 128.10 s | -3.1% |
| Joint DRC repair, summed | 320.69 s | 282.02 s | -12.1% |
| Total solve time, mean | 146.04 s | 133.97 s | -8.3% |

These are conditional measurements, not an overall speedup claim. They support investigating the hypothesis that fewer local route points reduce repair work, but do not offset the failures.

A focused local inspection of sample 1 counted 10,027 input points and 8,659 output points across 1,190 ordinary-node routes (13.6% fewer points), with about 0.62 s spent in this pass. This is a local diagnostic, not a paired performance benchmark.

## Failures and follow-up

- Samples 7 and 10: joint DRC repair threw `Pipeline9 clearance margin lost the original via transition`.
- Sample 8: global crossing-via reduction threw `found a layer transition without a via at route point 129`. The unchanged baseline passes its board test. Inspection found a non-colocated terminal transition marked `through_obstacle` after stitching; the later global simplifier removed that marker. Excluding terminal nodes from the early pass did not resolve this, so that trial was discarded.
- Sample 15: the shortcut dependency inherited a 1,000-step limit. The final draft fixes that separate issue using the source route's vertex count plus one as the incremental budget, with a regression test exceeding 1,000 protected vertices. The enabled benchmark has not been rerun after this limit fix; no improved completion rate is claimed.
- CI also found a relaxed-DRC regression on bugreport94 outside dataset 18, plus expected geometry snapshot differences. Snapshots were not updated to bless the enabled experiment.

Next experiments should first preserve or repair the via/terminal invariants above, and compare conservative simplification after force improvement versus before it. Only then should removal of global cleanup or actual networked throughput be evaluated.

## Validation

Focused checks cover detour reduction, immutable input and metadata, boundary copper, pad obstacles, configured copper clearance, vias, long routes, opt-in behavior, and distinct network policy with local/remote route parity. Existing networked tests also pass. The default-off mode retains the original regular-node solver and original cache policy.
