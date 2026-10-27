# Deterministic four-candidate port-point pathing

Target: reduce the original four-thread dataset 18 benchmark's
`portPointPathingSolver` phase time by at least 40%, while keeping new serial
phase cost within 40% of the original and maintaining identical new serial and
parallel routed output.

## Candidate policy

Exactly four tiny-hypergraph searches run per solveGraph invocation. Candidate
zero retains the baseline input, heuristic, ordering, and step budget. The three
alternatives use reverse, shortest-first, and longest-first order, distance
heuristic multipliers of 4, 10, and 20, and one eighth of the original search-step
budget. The native timeout acceptance criteria and congestion thresholds remain
unchanged; accepting a complete graph earlier can still change downstream route
quality.

Choose the completed candidate with the fewest logical steps; break ties by
index. Workers share an atomic best-completion-step bound. All candidates run
through the winning step before a tie can be ruled out. Scheduling changes the
amount of discarded speculative work, never the routed winner.

Serial execution interleaves one step per lane. With all alternatives failing,
their search steps add at most 37.5% of the original budget, excluding ceiling
rounding, setup, and native timeout finalization. This is not a wall-time bound.

## Local exploration

An unbounded four-way race often hit the same 2,000,000-step cap in every lane.
On sample 14 it increased phase time from about 7.48s to 8.87s in parallel;
sample 15 changed from 6.94s to 7.21s. Serial execution could cost about four
times the baseline. Merely racing four full-budget initializations did not
satisfy the objective.

The following is an **earlier quarter-budget prototype**, not validation of the
final one-eighth parameters. These are complete port-point wrapper times on the
same local machine; parallel times include constructing a fresh four-worker
runtime. Each serial/parallel pair produced byte-identical JSON output.

| SRJ18 sample | Original | New serial | New 4-worker | Output parity |
| --- | ---: | ---: | ---: | --- |
| 1 | 0.872s | 1.421s | 0.711s | Exact |
| 2 | 2.553s | 5.047s | 1.701s | Exact |
| 14 | 7.367s | 6.588s | 2.370s | Exact |
| 15 | 6.448s | 12.594s | 4.608s | Exact |

The quarter-budget version showed promising phase reductions but excessive
serial cost on several samples. This motivated reducing each speculative
budget from one quarter to one eighth. Stronger heuristics also changed
downstream congestion: sample 1's predicted failure-pressure sum rose from 5.09
to 9.12, while sample 15's fell from 114.78 to 17.02. End-to-end completion and
DRC are required before judging the approach.

Four tiny-hypergraph race tests passed locally: reordered completion, real
1/2/4-worker pools, unchanged inputs, resume parity, and failure propagation.
Five autorouter integration/regression tests passed. The execution environment
disconnected during the final 16-sample local sweep, before its final results
could be retrieved. The latest resume-budget test and final one-eighth
parameters therefore still require CI verification. Full local typechecking
encountered existing dependency-export and stale-test errors outside the changed
sources.

## Reproduce

From an installed PR checkout with Bun >=1.4.2:

```sh
bun scripts/build-solver-workers.ts
TINY_HYPERGRAPH_BASELINE_DIR=/path/to/installed-main-checkout \
  bun scripts/benchmark/benchmark-hypergraph-race.ts 1 2 14 15
```

Omit sample arguments to test all 16 samples. The script prints JSON rows and
throws on any complete port-point serial/parallel output mismatch. It compares
phase time only; run the standard PR benchmark for end-to-end completion:

```
/benchmark --dataset 18 --threads 4
```

No dataset-wide 40% speedup or serial slowdown limit has been established yet.
