# Experiment: selective high-density portfolio

Baseline: `637b6c581128238f6c61227a1c15be423d24baca`. This branch enables
`selectivePortfolio` for Pipeline9 regular-node routing. Other callers retain the
original fitness scheduler unless they explicitly opt in. B01, regional repair,
force improvement and joint DRC repair are unchanged.

## Hypothesis

An attempt that exhausts six A01 seeds repeatedly spends most of its time proving
only that its search allocations were insufficient. Equal raw iteration counts
also represent different costs in A01, A03, A13 and the native priority families.
Lazy candidate construction, bounded probes and cost-aware promotion should find
useful orderings sooner and reduce unsuccessful physical/grown attempts.

## Implementation

* Construct candidate descriptors first. Allocate geometry/grid and run setup only
  when admitting that candidate. Geometric solvers and one native family precede
  grid allocation, so easy nodes can finish without constructing a grid portfolio.
* Preserve the existing geometric, priority-DAG, A01, A03, negotiated A13 and
  polyline candidates. Admit all six A01 orderings as the race progresses.
* Advance in approximately 2–16 ms quanta, checking after bounded kernel batches.
  A13 receives one kernel call per clock check because each call already batches
  search. Construction, setup and losing probes count toward measured cost.
* Promote using best routed/conflict-adjusted progress, its measured execution
  cost and time spent without improvement. A stagnant 95%-routed candidate does
  not indefinitely prevent trying another family or seed. A13 progress includes
  congestion rather than treating provisional paths as finished routes.
* Calibrate the attempt allocation to **four natural A01 iteration allocations**
  at the median of three completed A01 measurement windows, each containing at
  least 4096 iterations and 2 ms of execution, after a bounded warmup prefix
  (one eighth of the natural cap, clamped to 4096–65,536 iterations). This
  avoids extrapolating the first JIT/setup-dominated search steps. A 50 ms ×
  effort floor applies. The
  allocation then stays fixed; later JIT improvements cannot shrink it.
  The natural cap is read after setup and the existing grid-budget restriction.
  All candidates receive at least one probe before this limit can terminate an
  attempt. A slower atomic step or setup may overshoot a quantum or the limit.
* Keep paused candidates and their rip histories intact. Allocation exhaustion
  marks the portfolio attempt `UNKNOWN`; it does not mark paused candidates
  failed or claim the physical node is infeasible. The existing explicit
  grow/shrink campaign continues after that limited attempt.

Four allocations deliberately replace potentially six full A01 caps plus other
families; this changes search policy and does not guarantee a one-third CPU
saving because setup, probes and evolving measured rates also contribute. It can lose a winner requiring more work,
choose growth instead of a physical solution, or change output quality. The first
2.5-allocation pilot stopped a known physical winner too early. Choosing four is
**calibration on that dataset18 development fixture**, not held-out evidence.
One early elapsed-clock/min-rate four-allocation run solved its 19 routes at scale1 in 3.22 seconds (A01 seed2,
1,715,575 iterations; attempt allocation 3431.9 ms). Its routes were not saved for
an independent physical check, so scale1 is not a clean-geometry claim.

A second elapsed-clock/min-rate fresh-process smoke pinned to CPU3 solved the same fixture at scale2 in
4.44 seconds (A01 seed5, 470,196 iterations; winning attempt allocation 2654.9
ms). After inverse scaling, independent production copper checks found 24
inter-net route pairs with literal overlap and 54 with 0.15 mm clearance; A13
reported 576 primitive findings at zero added clearance. These are intermediate
node outputs before downstream cleanup, not final board DRC errors. This adverse
repeat demonstrates that clock-sensitive selection can change growth and route
quality. Neither run establishes a speedup. Dataset24 is useful external evidence;
complete-board comparisons and further repetitions must judge the tradeoff.

The final CPU-clock/warmup/median smoke solved at scale1 in 4.525 seconds wall /
4.525 seconds CPU via A01 seed5 (1,474,214 iterations). Independent copper checks
found one literal-overlap route pair and 45 at 0.15 mm clearance. Its frozen
23.26-second allocation substantially exceeded actual work, illustrating remaining
route-dependent rate estimation risk despite excluding the warmup prefix. This
is not evidence of a faster or clean node, and a calibrated allocation is not a
guaranteed CPU reduction.

These early adverse repeats motivated a revision before the dataset experiment:
Node/Bun now uses `process.cpuUsage()` for admission, promotion and the allocation.
OS descheduling does not consume the race budget. GC and setup still consume real
CPU and correctly count. Browser consumers without that capability use elapsed
time; explicitly requesting CPU timing on an unsupported runtime throws. Set
`selectivePortfolioTiming: "elapsed"` for a portable clock ablation.

The calibrated allocation now freezes at a median of three completed windows,
rather than repeatedly shrinking to the fastest observed rate. Stats record the
selected clock plus both process CPU and elapsed wall time. CPU accounting removes
OS preemption from decisions, but different JIT/GC histories and route-dependent
cost per iteration can still change the race or overestimate the allocation. Repeated fresh-process comparisons under controlled load remain necessary;
iteration reductions alone cannot establish an improvement.

## Validation and reproduction

```sh
source /workspace/.tools/autorouter-env.sh
bun test tests/solvers/selective-portfolio-*.test.ts \
  tests/features/portfolio-a13-retains-successful-routing.test.ts \
  tests/solvers/priority-dag-family-allocation.test.ts \
  tests/solvers/portfolio-tracked-candidate-work.test.ts --timeout 9999999
bun node_modules/typescript/bin/tsc --noEmit
./benchmark.sh --pipeline 9 --dataset 18 --concurrency 1 --threads 1 --effort 1
./benchmark.sh --pipeline 9 --dataset 24 --concurrency 1 --threads 1 --effort 1
```

For a focused two-layer fixture replay with independent pairwise physical copper
checks and saved route geometry:

```sh
bun scripts/experiments/benchmark-selective-portfolio-node.ts selective > selective-node.json
bun scripts/experiments/benchmark-selective-portfolio-node.ts fitness > fitness-node.json
```

The ordinary branch runtime enables the experiment; no process-local patches or
shared dependency modifications are required. Set `selectivePortfolio: false`
in the Pipeline9 regular-node factory for an in-branch scheduler ablation, or use
the baseline commit for the complete unchanged control.

The mocked-clock tests cover lazy fast-path allocation, resuming a rare final-seed
winner despite stagnant high-progress competitors, preserving all paused
candidate states on `UNKNOWN`, identical CPU-accounted schedules with wall-clock
descheduling, a fixed allocation after later rate improvements, and terminal
`UNKNOWN` recording when BaseSolver exhausts its separate supervisor-dispatch
limit. That hard limit retains BaseSolver's generic iteration-budget error;
`selectiveAttemptStatus` and `selectiveUnknownReason` identify its search status. Legacy scheduler tests continue to cover the
unchanged default mode.

## Measurements

Per-attempt `stats.selectiveCandidates` records family, seed, measured setup/search
cost, best progress, iterations, limit, terminal state and quanta. Other stats
include admission count, allocation, measured cost and `selectiveAttemptStatus`.
`stats.selectiveClockSource` identifies the clock for per-candidate `elapsedMs`
and aggregate `selectiveElapsedMs`; `selectiveCpuMs` and `selectiveWallElapsedMs`
report both clocks explicitly. Shared `priorityDiagnostics` aggregates these numeric counters so they survive
retiring individual nodes:

* `portfolioSelectiveAttempts`
* `portfolioSelectiveAdmitted`
* `portfolioSelectiveUnconstructed`
* `portfolioSelectiveElapsedMicros`
* `portfolioSelectiveUnknownAttempts`
* `portfolioSelectiveCpuMicros`
* `portfolioSelectiveWallMicros`

Compare final DRC-clean completion first; then paired total and HD elapsed time,
force/repair time, censored timeouts, memory, vias and wire length. Attribute
upstream/other-solver failures separately, and replay captured HD inputs where
needed. Do not turn a dataset24 upstream failure into evidence against this
scheduler, or count a faster unresolved circuit as a speedup.

Full dataset18 and dataset24 results are added by the experiment coordinator.
