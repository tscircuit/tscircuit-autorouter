# Dataset 18 congestion rerouting

**Average worst-box PF fell 24.26%: 1.241670 → 0.940410.** Eight of 16 boards improved; none worsened. The rerouter accepted 36 of 129 attempted moves. Average total PF per board fell 2.35% (23.429253 → 22.878585).

Two independent integrated pathing runs matched every per-node PF value and rerouting statistic across all 16 boards. Every route passed the endpoint connectivity check. The score is a PF heuristic result, not proof of trace clearance.

| Full routing, 240-second cap | Baseline | Rerouting |
|---|---:|---:|
| Completed | 11/16 | 11/16 |
| Relaxed DRC passed | 8/16 | 8/16 |
| Timed out | 5/16 | 5/16 |

**Geometry tradeoffs:** sample004: DRC errors 5 → 17; sample008: DRC errors 1 → 4. These boards fail DRC in both variants. Lower PF does not guarantee fewer DRC errors.

| Board | Baseline max PF | Rerouted max PF | Completed baseline/new | DRC errors baseline/new |
|---|---:|---:|---|---|
| sample001 | 0.353788 | 0.353788 | True/True | 0/0 |
| sample002 | 1.356533 | 0.660019 | False/False | not completed/not completed |
| sample003 | 0.392213 | 0.392213 | True/True | 0/0 |
| sample004 | 0.909112 | 0.624281 | True/True | 5/17 |
| sample005 | 0.335331 | 0.335331 | True/True | 0/0 |
| sample006 | 3.771479 | 3.771479 | False/False | not completed/not completed |
| sample007 | 0.393531 | 0.393531 | True/True | 0/0 |
| sample008 | 0.657849 | 0.492897 | True/True | 1/4 |
| sample009 | 0.380592 | 0.380592 | True/True | 0/0 |
| sample010 | 0.767995 | 0.658553 | True/True | 0/0 |
| sample011 | 1.000000 | 0.400710 | True/True | 0/0 |
| sample012 | 1.000000 | 0.304515 | False/False | not completed/not completed |
| sample013 | 0.971341 | 0.910039 | True/True | 32/27 |
| sample014 | 1.000000 | 1.000000 | False/False | not completed/not completed |
| sample015 | 6.137319 | 3.928966 | False/False | not completed/not completed |
| sample016 | 0.439643 | 0.439643 | True/True | 0/0 |

Implementation restores original graph port permissions after section optimization, mapped by stable port identity while preserving disabled ports. It also reconnects adjusted regional routes at exact original endpoints before stitching, preventing the plated-hole quantization failure found during validation. The PF definition and rerouting budgets are unchanged.

Pipeline 7, effort 1, all 16 dataset18 boards; pinned dataset commit 100e8957ce789b5b288e14c476dc83f4efc5214b. Four fresh Bun processes on 4-vCPU ARM Blacksmith. PF search uses a 600-second cooperative cap (630-second process cap); full routing uses 240/270 seconds. Both final full-run variants include endpoint restoration and differ only in congestion rerouting. Timings vary by VM load; no speedup claim.

Initial PF timeouts were retained and repeated at the declared longer cap. First candidate was rejected for a downstream invariant error. A VM lifetime interruption and a misconfigured launch were excluded from acceptance and documented in the isolated experiment log. Raw successful and failed evaluations are retained.

Isolated experiment snapshot: `33377ad578a4df13a71e881d391107aa69437817` (Dream run 2, node 2). Local checks: 15 development/regression tests, 4 boundary tests, focused TypeScript, and sample8 reproduction. The experiment used two continuation attempts (three of the original eight in total).


## Reproduction

Run benchmarks on Blacksmith from the repository root:

```sh
# All 16 boards, both variants, stop after port-point pathing
CONGESTION_BENCHMARK_PATHING_ONLY=1 CONGESTION_BENCHMARK_OUT=/tmp/congestion-pf bun scripts/benchmark/congestion-rerouting-dataset.ts

# Full routing, paired baseline/rerouting, 240-second cooperative cap
CONGESTION_BENCHMARK_TIMEOUT_MS=240000 CONGESTION_BENCHMARK_OUT=/tmp/congestion-full bun scripts/benchmark/congestion-rerouting-dataset.ts
```

`measurements.json` retains the pathing baseline, candidate pathing run, and final paired full-routing results, including per-board PF summaries and all timeouts. Full per-node maps remain in the saved isolated experiment artifacts and are emitted by the harness. `summary.json` contains the paired completion/DRC counts and regressions. The original synthetic-only experiment was superseded by these dataset measurements.

Validation: 19 focused tests passed (114 assertions), plus the focused TypeScript check. Tests used the standard repository preload with the experiment dependencies. No formatter or linter was run.
