# Deterministic four-candidate port-point pathing

Target: reduce the original four-thread dataset 18 benchmark's
`portPointPathingSolver` phase time by at least 40%, while keeping new serial
phase cost within 40% of the original and maintaining identical new serial and
parallel routed output.

## Candidate policy

Exactly four tiny-hypergraph searches run per solveGraph invocation. Candidate
zero retains the baseline input, heuristic, ordering, and step budget. The three
alternatives use distance heuristic multipliers of 4, 4, and 10, with only the
first reversing the initial order, and one eighth of the original search-step
budget. Alternatives require native completion; only the original candidate
retains its native timeout acceptance. Congestion thresholds remain unchanged.
Preloaded-copper inputs retain the original heuristic/order in all four lanes,
with distinct strict alternative budgets of 1/8, 1/10, and 1/12.

Choose the completed candidate with the fewest logical steps; break ties by
index. Workers share an atomic best-completion-step bound. All candidates run
through the winning step before a tie can be ruled out. Scheduling changes the
amount of discarded speculative work, never the routed winner.

Serial execution batches 128 native steps per lane. With all alternatives failing,
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

## First remote benchmark: phase win, rejected routing quality

The requested command completed on snapshot `15c9475`:
https://github.com/tscircuit/tscircuit-autorouter/pull/3303#issuecomment-6431466504

| Metric | Original | Prototype | Change |
| --- | ---: | ---: | ---: |
| Serial port-point aggregate | 140.038s | 106.489s | -24.0% |
| Four-thread port-point aggregate | 152.051s | 60.603s | -60.1% |
| Four-thread completion | 100% | 93.8% | Regression |
| Four-thread relaxed DRC pass | 100% | 87.5% | Regression |
| Four-thread DRC issues | 0 | 257 | Regression |
| Four-thread total recorded stage time | 554.172s | 1077.994s | +94.5% |

Samples 12 and 15 regressed in both execution modes. The isolated phase target
was met, but end-to-end correctness/performance regressed. This is not a
successful implementation of the broader routing goal.

## Current revision: strict speculative completion

Current candidates use distance multipliers 1/4/4/10. Only candidate 1 reverses
the initial order; candidates 2/3 preserve it. Synchronous execution batches
128 native steps per lane, preserving the minimum-native-step/index winner.

Speculative candidates cannot use timeout acceptance. Only the unchanged
original candidate retains the caller's native timeout policy. Preloaded-copper
inputs retain the original heuristic/order in all four candidates, with distinct
strict alternative budgets of 1/8, 1/10, and 1/12; candidate zero wins equal
native completions. All modes still instantiate exactly four candidates.

Before another workspace disconnection, the conservative-order/batched
prototype passed all five race unit tests, restored zero DRC errors for SRJ18
sample 9, and preserved the SRJ23 sample 21 repair residue. The local sample 9
test had a stale repair-path assertion; the current repository test already
permits initial bounded regional acceptance and independently requires zero
physical DRC errors. The Muse fixture had zero DRC errors but its visual helper
expected a via no longer present in the new topology.

The conservative prototype's first 11 local phase samples summed to about
33.29s original, 27.12s new serial, and 13.19s new four-worker execution, with
complete port-point output parity in every completed pair. These measurements
precede the latest strict timeout policy and do not validate its speed.
A fresh full PR benchmark is required.
