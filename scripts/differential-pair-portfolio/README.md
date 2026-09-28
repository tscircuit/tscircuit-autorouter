# Shared-spine differential-pair experiment

This experimental harness compares the existing coupled rerouter with actual A13 and B01 high-density solvers. It is not connected to a production autorouter pipeline.

A/B route a conservative copper envelope: centerline spacing plus the larger member width, with a corresponding paired-via envelope. Existing terminal-station and clearance helpers prepare real pad escapes. The spine expands into both original nets, runs the existing length matcher, and passes final validation before replacing any pair. Other routes and fixed copper remain immutable. Rejected optimization candidates leave available copper intact; internal invariant errors remain visible.

The portfolio interleaves the three strategies in approximately 2 ms cooperative quanta. It shares one wall-time budget across search, expansion, tuning and acceptance validation. Individual synchronous steps can exceed the deadline; late results are not credited as winners. This is single-threaded scheduling, not worker parallelism. Completed pair checkpoints survive budget exhaustion. An already-valid input is not replaced by an invalid candidate.

## Limitations

- A13 does not search around fixed copper. Its existing board-validation wrapper rejects blocked spines. Short terminal grid snaps are removed before expansion, then the expanded lanes are checked again.
- B01 searches at most a 15 mm window on each axis. Larger boards can use an explicitly reported local window only when both terminal envelopes fit. Copper dimensions are never scaled; longer spans are unsupported.
- Pair-connected terminal obstacles are omitted only from the provisional thick-spine search. Terminal preparation and final validation retain the full original obstacle set and net identities.
- A/B currently try one requested/preferred spacing. The joint solver retains its existing spacing search. Both output-side constraints are identical.
- Final checks cover endpoints, continuity, widths, fixed copper, clearance, length tolerance and paired layer transitions. Explicit `traceGap` is checked by sampling at at most 0.02 mm, with 0.05 mm gap and 15-degree tangent tolerance. These tolerances and corner behavior are experimental, not a proof of electrical compliance.
- `maxUncoupledLength` limits each terminal escape independently. Total and interior uncoupling are separately reported. Soft min/max centerline preferences are not converted into hard acceptance constraints. Missing gap information cannot certify a declared coupling budget.
- The length matcher may break coupling while fixing skew. Such output is rejected. Pair-aware tuning is a remaining algorithmic problem.
- The prototype imports private helpers from the explicitly pinned length-matching revision. A stable dependency API is needed before production integration.

## Reproduce

`benchmark.ts` accepts `--input <native-params.json>` or `--manifest <manifest.json>`, `--budget-ms 5000`, `--modes joint,a,b,all`, and `--out <directory>`. A manifest is `{ "cases": [{ "id": "case", "path": "relative-input.json", "constraints": [] }] }`. Inputs must contain captured HD routes or already-routed simplified traces; raw unrouted boards are not invented into stage inputs.

Each mode consumes identical normalized parameters. Results record input hashes, output origin, candidate counts, unsupported reasons, CPU and wall time, budget overrun, and final validation. Output availability and unchanged valid input are distinct from a new strategy win. Pilot post-output reoptimization inputs are labeled separately from faithful pre-postprocessing captures.

Use Blacksmith for benchmark runs and local commands for focused validation:

```sh
bun test tests/differential-pair-portfolio --timeout 9999999
bun run format:check
bunx tsc --noEmit
```
