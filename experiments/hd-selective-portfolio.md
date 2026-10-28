# Experiment: selective high-density portfolio

Baseline: `637b6c581128238f6c61227a1c15be423d24baca`. This branch enables
`selectivePortfolio` for Pipeline9 regular-node routing. Other callers retain the
original fitness scheduler unless they explicitly opt in. B01, regional repair,
force improvement and joint DRC repair are unchanged.

## Narrow v2 corrections and preserved v1 evidence

V1 at `69f911acf376cef278780f307184aee151d64741` was measured on all 16 dataset18
and all 26 dataset24 circuits with pipeline9, effort1, a 360-second sample limit,
three pinned sample lanes, one routing thread and identical resolved dependencies.
The baseline and experiment ran sequentially on the same ARM64 Blacksmith runner.
This is one exploratory paired pass, not a repeated randomized estimate.

| Dataset | Completed-HD cohort | HD seconds, control → v1 | HD speedup | Final clean, control → v1 | Paired-clean board speedup |
| --- | ---: | ---: | ---: | ---: | ---: |
| 18 | 16 | 313.738 → 236.603 | 1.326× | 16 → 15 | 0.979× across 15 |
| 24 | 21 | 584.438 → 406.741 | 1.437× | 17 → 17 | 1.022× across 17 |

The component gain is real evidence worth preserving. Dataset18's quality loss
and added downstream repair prevent calling it an overall improvement. The
completed-HD dataset24 cohort includes some boards that subsequently fail; it is
not a claim that all 26 boards completed or accelerated. V1's numerical CI also
reported DRC/connectivity regressions and unequal serial/four-worker output.
Benchmark: https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40634267642
Numerical CI: https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40634267621

V2 makes three bounded corrections without replacing the race or changing its
four-allocation policy:

1. Selective mode wraps A01 output reconstruction. A distinct actual end terminal
   is appended when both terminals occupy one grid cell. The endpoint comes from
   the public `solvedConnectionsMap` in the base output's order, with explicit
   alignment checks; no nearest-point guess is involved. The wrapper retains
   A01 `instanceof`, solver name, search, iteration limits and multi-cell output.
   Legacy mode still constructs the original A01 class. This fixes that specific
   reconstruction bug, not every possible grid-alias/connectivity issue.
2. Selective mode admits A03 only for its known supported 0.1 mm width. Other
   widths, including the implicit 0.15 mm default, exclude that candidate before
   construction. Directly requesting an ineligible selective A03 candidate throws.
   It never substitutes a narrower width. Legacy candidate eligibility remains
   unchanged. The existing A03 comment documents why passing an arbitrary width
   is not a demonstrated supported alternative.
3. When available, the race uses `process.threadCpuUsage()`. Process CPU includes
   unrelated worker threads and was the wrong scope for per-candidate decisions.
   `threadCpu`, `cpu` and `elapsed` are explicit clock modes; automatic capability
   selection prefers thread CPU, then process CPU, then elapsed time. Unsupported
   explicit CPU requests throw. Stats identify clock scope and capabilities, and
   report thread CPU, process CPU and wall time separately. Compatibility process
   mode retains its documented cross-worker interference. Thread CPU removes that
   scope bug; JIT, GC and timing-based cutoffs still prevent an exact parity claim.

Selective cache keys carry policy version2, including explicit process-clock
ablations, so old selective outputs cannot hide the endpoint/eligibility changes.
Legacy cache keys are unchanged. No snapshots, physical checks or grown-proposal
acceptance rules are weakened. Missing full drill/NPTH-rule context and remaining
DRC/worker-parity concerns remain open; v2's full dataset validation is separate
from the preserved v1 results above.

## Final v2 promotion blocker

At published final solver source `c7f2715d98117a4b28dbe9fcaceab873a0cd72cd`,
centralized local TypeScript/build checks and CI compilation passed. The packed
Bun runtime check failed: the preceding exact final route JSON equality passed,
but worker iterations1901 differed from serial1902, masking the later HD-stats
assertion. A separate native four-worker sample001 test also failed complete
serialized routed-SRJ equality, so the limitation goes beyond iteration counts.
These are failures of this timing-based policy and block promotion. Thread CPU
scope fixes interference from unrelated workers; it does not make timing-driven
selection deterministic. No assertion or snapshot has been weakened.

Final-source T113 same-net drill validation still failed at line86: expected zero
via-clearance errors, received two (job122666541989). This is a real unresolved
numerical defect, separately from worker parity and the measured initial-HD gain.

The final-source job also reached bug94/88 SVG comparisons after their preceding
numerical checks passed. That specific evidence does not clear every board,
physical-rule context or parity concern. The one-routing-thread final dataset18/24
follow-up is still pending and remains separate from the preserved v1 evidence:
https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40643404125
Current CI: https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40643404157

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
* Preserve the existing geometric, priority-DAG, A01, negotiated A13 and
  polyline candidates, plus A03 when its requested-width capability is met. Admit all six A01 orderings as the race progresses.
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

These early adverse repeats motivated v1's process-CPU revision before the
first dataset experiment. V2 now prefers `process.threadCpuUsage()` for admission,
promotion and the allocation, avoiding CPU spent by unrelated worker threads.
Setup and work on the current thread count; background threads are excluded.
`selectivePortfolioTiming: "cpu"` retains the v1 process-clock compatibility mode;
`"elapsed"` selects the portable elapsed-clock ablation. Unsupported explicit
CPU-clock requests throw. The selected capability and scope are reported.

The calibrated allocation now freezes at a median of three completed windows,
rather than repeatedly shrinking to the fastest observed rate. Stats record the
selected clock plus thread CPU, process CPU and elapsed wall time. CPU accounting removes
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
unchanged default mode. V2 adds real one-cell terminal connectivity, exact
multi-cell output/search parity, A03 width eligibility, explicit clock capability
selection and isolation from simulated unrelated worker CPU.

## V2 numerical follow-up

The existing nonvisual sample9 regression test passed at solver-fix commit
`770361dc8aea701c766dc5e745555b4afe2dc049`: one test, seven assertions, zero
final joint-repair issues and zero final relaxed-DRC errors. The run observed
840 accepted selective nodes: 837 at scale1 and three at scale2. The one-cell
wrapper restored actual end terminals in two accepted scale1 A01 winners,
`cmn_1366` and `cmn_1342` (PCB terminals330 and309).

The three grown winners were `cmn_137` (A01 seed0), `cmn_110` (native public
solver name `IntraNodeRouteSolver`) and `cmn_20` (A03 seed0). The saved numerical
summary records winner iterations, limits, public family names and exact
restored endpoint coordinates in `hd-selective-portfolio-v2-sample9.json`.
Observation hooks recorded output/acceptance without changing returned geometry.
This functional run is not a latency benchmark, does not isolate which change
removed the previous final issue, and does not establish that USB-DP, bug94,
T113, complete datasets or worker parity are fixed.

## Measurements

Per-attempt `stats.selectiveCandidates` records family, seed, measured setup/search
cost, best progress, iterations, limit, terminal state and quanta. Other stats
include admission count, allocation, measured cost and `selectiveAttemptStatus`.
`stats.selectiveClockSource` identifies the clock for per-candidate `elapsedMs`
and aggregate `selectiveElapsedMs`; `selectiveCpuMs` and `selectiveWallElapsedMs`
report process and wall clocks explicitly; `selectiveThreadCpuMs` records the
current thread when supported. Concurrent per-attempt process CPU measurements
overlap across worker threads and must not be summed as independent CPU work. Shared `priorityDiagnostics` aggregates these numeric counters so they survive
retiring individual nodes:

* `portfolioSelectiveAttempts`
* `portfolioSelectiveAdmitted`
* `portfolioSelectiveUnconstructed`
* `portfolioSelectiveElapsedMicros`
* `portfolioSelectiveUnknownAttempts`
* `portfolioSelectiveCpuMicros`
* `portfolioSelectiveWallMicros`
* `portfolioSelectiveThreadCpuMicros`
* `portfolioSelectiveThreadCpuAttempts`
* `portfolioSelectiveProcessCpuAttempts`
* `portfolioSelectiveElapsedClockAttempts`
* `portfolioSelectiveA03ExcludedAttempts`

Compare final DRC-clean completion first; then paired total and HD elapsed time,
force/repair time, censored timeouts, memory, vias and wire length. Attribute
upstream/other-solver failures separately, and replay captured HD inputs where
needed. Do not turn a dataset24 upstream failure into evidence against this
scheduler, or count a faster unresolved circuit as a speedup.

V1 dataset evidence is preserved above. V2 full dataset18 and dataset24 results
are added separately by the experiment coordinator.
