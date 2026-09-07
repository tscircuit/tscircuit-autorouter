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

Baseline measurements and solver explanations will be recorded here after the
serial discovery and instrumented Blacksmith runs.
