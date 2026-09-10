# Quality and timing acceptance for the sample 2 experiments

## Reusable helper

`quality.ts` exports `evaluateNodeQuality(input)` and the TypeScript types
`NodeQualityInput` / `NodeQualityResult`. It only imports Node's `crypto`, so it
can be copied alongside the Blacksmith experiment harness without depending on
a particular checkout layout.

```ts
const quality = evaluateNodeQuality({
  node: physicalNode,
  routes: completedRegularSolver.solvedRoutes,
  traceWidth: 0.1,
  viaDiameter: 0.3,
  layerCount: 2,
  solved: completedRegularSolver.solved,
  failed: completedRegularSolver.failed,
})
```

Pass physical, scaled-back output, not the intermediate 2×/4× search coordinates.
The helper checks every explicitly requested terminal pair, numerical and layer
validity, physical dimensions, and the presence of vias at layer transitions.
It records copper length, via count, a geometry fingerprint rounded to 1e-8 mm,
and centerline excursions beyond the node rectangle. A tiny border excursion is
reported, not treated as final-board failure: internal node boundaries are not
the board edge. Pair coverage checks the current solver's one-route-per-pair
contract, not arbitrary connected trees represented by several route objects.

`structuralChecksPassed` deliberately does not mean DRC passed. Local clearance
diagnostics use physical trace widths and via diameters, with 0.1 mm edge
clearance. Their counts are violating route pairs, via/route pairs, and via
pairs, not the counts emitted by the repository DRC implementation. Same-net
trace contacts are excluded using normalized `rootConnectionName`. Vias are
assumed to span both layers, appropriate to this sample. Pads, preloaded copper,
neighboring nodes, board outline, and original board connection requirements are
absent; therefore these diagnostics cannot certify a completed PCB. No local
diagnostic is substituted for the full-sample evaluator.

## Baseline local output

Applying the helper to `work/hard-node-video/result.json` yields:

- 26 routes cover all 26 requested pairs, with 53 vias and 392.4086 mm of wire.
- All trace widths remain 0.1 mm; all via diameters remain 0.3 mm.
- No non-finite points, invalid layers, or missing transition vias.
- Geometry SHA-256: `ed01367c7956930b20a04cd80fef4b1ff03044e97c914cab4b7e45a2bb0f6909`.
- Local diagnostics: 66 different-net trace pairs below 0.1 mm clearance,
  including 18 copper overlaps; 126 via/trace pairs below clearance; 7 via pairs
  below clearance. These are *not* final benchmark DRC counts.

The current grow/shrink wrapper scales terminal coordinates and node dimensions,
but does not scale trace widths or via diameters. It restores only coordinates
when accepting the 4× solution. Thus the accepted node output already relies on
subsequent full-board repair. A variant may solve the node quickly yet increase
later repair work, fail repair, or leave final DRC errors. Simply requiring local
zero DRC would reject the known baseline and would not reproduce the pipeline's
actual acceptance contract.

## Full-sample authoritative check

Use the same evaluator and output method as
`tests/features/pipeline9-srj18-sample2-bounded-regional-drc.test.ts` and
`scripts/benchmark/benchmark-run-task.ts`:

```ts
import { evaluateRelaxedDrc } from "./lib/testing/evaluate-relaxed-drc"

if (!solver.solved || solver.failed || !solver.srjWithPointPairs) {
  throw new Error(`Sample 2 failed: ${solver.error}`)
}
const { errors, errorsWithCenters } = evaluateRelaxedDrc({
  inputSrj: scenario,
  srjWithPointPairs: solver.srjWithPointPairs,
  routedTraces: solver.getOutputSimplifiedPcbTraces(),
})
```

The evaluator automatically includes preloaded copper and uses original
connections. Do not concatenate preloaded copper yourself or evaluate only new
traces. Do not disable continuity or typed clearance checks. Do not lower the
rules for an approach. Benchmark relaxed rules specify trace clearance 0.1 mm
and via clearance 0.1 mm; the native evaluator includes trace overlap,
continuity, pad/trace, via/trace, via/via, and out-of-board checks. A benchmark
pass is not certification against every manufacturing rule a board may declare.

Acceptance for a promising optimization requires all of:

1. The same sample data, source baseline, effort, layer count, and copper widths.
2. Successful node output with all terminal pairs and dimensions preserved.
3. Successful full-sample completion and zero errors from `evaluateRelaxedDrc`.
4. Lower total sample solver time, not just lower selected-node time. Record
   high-density stage, joint repair, simplify, and other stage timings too.
5. Record final via count and trace length alongside runtime, so the speed/route
   quality tradeoff is visible. A different fingerprint means different geometry,
   not automatically worse quality.

The regression test also bounds regional repair work: attempted regions ≤4,
candidate attempts ≤1,024, and path-search nodes ≤480,000. Report those statistics
for variants; an optimization should not remove those constraints or hide a
failure by accepting partial geometry.

## Timing controls

- Run systematic timed comparisons on Blacksmith, per repository `AGENTS.md`.
  Local helper checks and deterministic correctness tests are allowed.
- Compare approaches in the same sequential job, with identical Bun version and
  CPU allocation. Use fresh processes/caches, consistent inputs, and more than
  one repetition when practical. Include baseline in the same job; do not use
  the heavily instrumented 20.7566-second video capture as the timing control.
- Exclude visualization snapshots, JSON writes, the quality helper, and final
  DRC evaluation from the solver timer. Report their time separately if relevant.
- Keep instrumentation identical between baseline and approaches. Candidate
  step wrappers and snapshot callbacks have measurable overhead.
- Record whether the strategy is applied only to `cmn_4__sub_2_0` or to all nodes.
  A sample-specific intervention is useful causal evidence, but should not be
  presented as a general routing improvement without broader validation.
- A direct 4× start is an aggressive experimental control. Its gain may reflect
  skipping unsuccessful work; its physical result still needs downstream repair.
- Preserve failed approaches in the report. A faster failure, partial routes,
  narrower copper, or final DRC regression is not a successful speedup.
