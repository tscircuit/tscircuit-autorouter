# SRJ18 iteration timing

The `SRJ18 Iteration Timing` workflow runs the fastest measured successful
dataset-srj18 sample through the exported default autorouter (Pipeline 7), with
effort 1 and caching disabled. It runs in a separate serial Blacksmith ARM job.
The ordinary test shards skip this benchmark unless `SRJ18_ITERATION_TIMING=1`.

```sh
SRJ18_ITERATION_TIMING=1 bun test tests/benchmarks/srj18-iteration-timing.test.ts --timeout 600000
bun scripts/benchmark/srj18-iteration-timing.ts --discover
SRJ18_ITERATION_THRESHOLD_MS=100 bun scripts/benchmark/srj18-iteration-timing.ts
```

The warning threshold starts at 1,000ms. The report also retains every pipeline
iteration over the eventual 100ms target, so the whitelist can be reviewed before
lowering the threshold. Both whitelisted and unlisted iterations over the warning
threshold emit warnings. New slow work does not fail CI during this discovery
phase; routing failures do fail the test.

## What an iteration means

An iteration is one synchronous call to the pipeline's `step()`. It can call
several nested solvers' `step()` methods or even their entire `solve()` loops before
returning control. Measuring the whole pipeline call detects that blocking even
when each individual child step is fast.

The opt-in profiler observes both this repository's BaseSolver and the external
solver-utils BaseSolver, plus the step implementations of active children. It
records the actual nested call path before completed children are cleared. Time
spent in a child belongs to that child, rather than being counted again against
its parents. A synchronous loop over many child steps is shown with the child's
first and last local iteration. Separate material contributors remain visible.

Initialization is iteration **0**: constructor parameters and synchronous
construction before the new solver receives its first `step()`. Subsequent
iterations are **1-based per solver instance**. Initialization and step 1 are
separate whitelist entries. Solver class, phase, and local iteration (or exact
observed range for a synchronous loop) must match. An ancestor's whitelist entry
never authorizes a descendant.

`scripts/iteration-timing/srj18IterationWhitelist.ts` contains the reviewed
exceptions and reasons. To remove an exception, move its expensive synchronous
work into incremental solver steps, rerun the benchmark, then remove the matching
entry once it stays under budget.

## Reports and rediscovery

The workflow uploads `iterations.json` and `summary.md`; JSON includes every
retained pipeline iteration, full solver paths, material contributors, aggregate
solver timings, and runtime identity. Timing includes profiler overhead, so the
numbers identify blocking work rather than serving as throughput benchmarks.

Manual `discover_fastest` runs time all 16 samples serially in fresh processes,
then repeat the three fastest successful candidates and select by median. Failed
and timed-out samples are explicitly excluded. `discovery.json` and `discovery.md`
retain the results. Discovery does not silently change the pinned regression
sample or whitelist; review the result and update the constant when needed.

## Initial observations

The [serial Blacksmith baseline](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/34165277363)
used Bun 1.3.8 on Linux ARM64 with the dataset pinned at
`c0aad90256a95256fcac814f9f7da81a82a2fdea`. All 16 samples were attempted; five
completed the first pass and eleven exceeded the approximately 60s deadline.
The three fastest completed samples were each measured three times:

| Sample | Board | Median | Three trials |
| --- | --- | ---: | --- |
| **sample005** | **Arduino Uno** | **25.13s** | 25.13s, 25.17s, 24.97s |
| sample003 | Arduino Micro | 30.24s | 30.38s, 30.24s, 30.03s |
| sample001 | Arduino Leonardo | 33.67s | 33.49s, 33.67s, 34.33s |

The first instrumented run completed 247,488 pipeline iterations. Two exceeded
the initial 1,000ms warning budget, identifying the first three material
solver/iteration identities (initialization includes argument preparation):

| Pipeline iteration | Wall time | Exact whitelist entries |
| ---: | ---: | --- |
| 9255 | 1,288.1ms | `DuplicateCongestedPortSolver` step **1** (706.4ms self), `TinyHypergraphPortPointPathingSolver` initialization **0** (259.7ms self); the remaining time includes many short nested connection solves. |
| 199986 | 1,627.0ms | `HighDensitySolver` initialization **0** (1,626.9ms). |

A [subsequent repeat](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/34166676921)
measured **UniformPortDistributionSolver initialization 0** at **1,035.5ms** in
pipeline iteration **199302**, after earlier measurements of 931.0ms and 983.9ms.
This is the fourth whitelist entry. That repeat measured iterations 9255 and
199986 at 1,751.2ms and 1,773.0ms respectively.

These measurements include profiler overhead and are observations, not fixed
timing assertions. The whitelist covers all three pipeline iterations observed
over 1s across the Blacksmith runs. Entries below 1s remain visible in the report
without automatically gaining whitelist status.

The measured initialization interval includes parameter preparation immediately
before `new Solver(...)`. These are the source operations associated with the
initial hotspots; timing does not isolate individual helper functions within
each interval.

| Solver / local iteration | Synchronous work to consider splitting up |
| --- | --- |
| `DuplicateCongestedPortSolver` step 1 | The first setup routes every connection independently with synchronous `TinyHyperGraphSolver.solve()` calls, counts used ports, clones the graph, and duplicates congested ports. Instrumented child solve calls are reported separately. |
| `TinyHypergraphPortPointPathingSolver` initialization 0 | Builds and serializes the hypergraph, runs the congestion duplication prepass, constructs the tiny section pipeline, and reconstructs input-node metadata. |
| `UniformPortDistributionSolver` initialization 0 | Prepares the pathing output, finds ownership pairs for all node port points, precomputes shared edges, and sorts them. |
| `HighDensitySolver` initialization 0 | Prepares cloned nodes and computes failure probability for each node. `computeNodePf()` repeatedly calls `getOutput()`, which rebuilds the complete region output. The constructor itself mainly assigns fields. |
| `MultipleHighDensityRouteStitchSolver3` initialization 0 | Sorts routes, builds clearance indexes and connectivity islands, chooses endpoints and paths, and consolidates fragmented connections. |
| `CrossingViaReductionSolver` step 1 | Runs the crossing reduction search: splits routes into sections, finds detours, builds indexes, enumerates candidates, checks clearance, and applies a reduction or completes. |
| `GlobalDrcForceImproveSolver` later steps | Clones and materializes route geometry for several repair candidates, then runs whole-route DRC for each. This occurs both directly and inside `GlobalDrcBranchPortfolioSolver`; the deepest solver's own call number is reported in both cases. |

Relevant source: Pipeline 7's stage definitions; the tiny-hypergraph
`DuplicateCongestedPortSolver`; `TinyHypergraphPortPointPathingSolver`'s
constructor and `computeNodePf()`; and the corresponding solvers' constructors
and `_step()` methods. The JSON artifacts preserve the exact active paths and
local iterations for each observation.

## Confirmation and 100ms watchlist

The [confirmation run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/34166478437)
used the final attribution rules and matched both slow pipeline iterations to the
three whitelist entries: iteration 9255 was **1,284.4ms**, and iteration 199986
was **1,767.4ms**. It completed 247,488 iterations with **zero unlisted iterations
over 1s**. The full instrumented solve took 43.53s.

The following is the complete set of material contributors in its 27 retained
pipeline iterations over 100ms. Values are attributed time, excluding separately
reported nested calls. Comma-separated call numbers are independent observations;
an en-dash denotes multiple synchronous calls within one pipeline iteration.
Whitelist status includes the subsequent repeat that added port distribution.
Only the four entries explicitly marked "whitelisted" are approved at the initial
1s budget. The others are the starting worklist for the 100ms budget.

| Deepest solver | Phase | Observed local calls | Largest attributed time | Status |
| --- | --- | --- | ---: | --- |
| RectDiffGridSolverPipeline | initialization | 0 | 124.3ms | Candidate |
| TopologyMergingSolver | step | 316 | 176.1ms | Candidate |
| DuplicateCongestedPortSolver | step | 1 | 683.7ms | Whitelisted contributor |
| TinyHypergraphPortPointPathingSolver | initialization | 0 | 261.1ms | Whitelisted contributor |
| SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments | initialization | 0 | 100.3ms | Candidate |
| TinyHyperGraphSectionSolver | initialization | 0 | 109.8ms | Candidate |
| UniformPortDistributionSolver | initialization | 0 | 983.9ms | Whitelisted after repeat reached 1,035.5ms |
| HighDensitySolver | initialization | 0 | 1,767.4ms | Whitelisted |
| SingleHighDensityRouteSolver | step | 1–77, 600–699 | 153.2ms | Candidate: synchronous batches |
| CachedIntraNodeRouteSolver | initialization | 0 | 118.7ms | Candidate |
| CachedIntraNodeRouteSolver | step | 238–250 | 173.2ms | Candidate: synchronous batch |
| HighDensityForceImproveSolver | step | 315 | 149.2ms | Candidate |
| MultipleHighDensityRouteStitchSolver3 | initialization | 0 | 262.0ms | Candidate |
| CrossingViaReductionSolver | step | 1 | 484.3ms | Candidate |
| GlobalDrcForceImproveSolver | step | 1, 2, 22, 24, 25, 26, 27, 28, 30, 32 | 293.5ms | Candidate: repeated whole-route DRC |
| PostProcessingSolver | initialization | 0 | 137.5ms | Candidate |
| PowerTraceExpansionSolver | initialization | 0 | 112.0ms | Candidate |

Additional candidate work: topology merging's last step finalizes and validates
the merged regions; section-solver construction rebuilds its baseline and
intersection summaries; high-density force improvement processes a whole node
through multiple force/clearance passes; length-matching post-processing clones
the input and builds a private copper model. The artifacts include full paths to
distinguish direct DRC repair from repair inside a portfolio solver.

The other setup intervals build obstacle indexes (`RectDiffGridSolverPipeline`),
allocate graph routing/candidate storage (`SelectiveReripTinyHyperGraphSolver`),
group route endpoints and compare their minimum spacing (`CachedIntraNodeRouteSolver`),
or clone traces and prepare connectivity, width deficits, and obstacle indexes
(`PowerTraceExpansionSolver`). Caching is disabled: the cached solver's name does
not imply cache I/O caused its delay.

The high-density search ranges are synchronous batches: the portfolio requests
`MIN_SUBSTEPS = 100`, and `HyperParameterSupervisorSolver` runs those child steps
inside one parent call. `SingleHighDensityRouteSolver` repeatedly expands search
candidates, checks clearance, and enqueues neighbors. `CachedIntraNodeRouteSolver`
orchestrates route searches and scans completed routes for via/trace conflicts;
its separately timed descendants are not double-counted.
