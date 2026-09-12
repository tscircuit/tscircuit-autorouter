# Allwinner T113 fixed-input routing comparison

This benchmark gives native Pipeline 9 and Freerouting 2.4.1 the same frozen
signal-routing problem and the same wall-clock deadline. The board is
[seveibar/allwinner-t113-dev-board](https://tscircuit.com/seveibar/allwinner-t113-dev-board).
Earlier native and external runs used different inputs and time budgets; this
benchmark does not use those runs as comparative evidence.

## Frozen workload

`tests/fixtures/allwinner-t113/manifest.json` records the SHA256 of the input,
source provenance, and each projection step. The compressed source and the
projection script are committed so fixture regeneration can be checked byte for
byte. The frozen input contains 138 multi-terminal nets, 434 terminals, and 699
obstacles at their original XY positions on a 142 × 112 mm board.

Both engines receive this restricted common model:

- Two routing layers (`top` and `bottom`), with through vias only.
- Rectangular pads/keepouts; original round/oval shapes use bounding rectangles.
- Uniform 0.15 mm trace width and clearance; 0.6 mm via copper / 0.3 mm drill.
- Identical multi-terminal electrical net membership and through-pad connectivity.
- No preloaded copper, planes, fanout stage, differential-pair constraints,
  controlled impedance, bus skew rules, or automatic neckdown.

This is a signal-only projection before fanout. It does not reproduce the lost
effective SRJ from the original native failure or the actual four-layer PCB.
The loader and DSN adapter reject unsupported geometry instead of silently
approximating additional features. Any adapter change that changes this model
needs a new fixture/manifest, rather than quietly changing the workload.

## Running

Run benchmarks on Blacksmith using the **Allwinner Fixed Input Benchmark**
workflow. Its pull-request trigger runs this benchmark when the runner or
fixture changes; after merge, `workflow_dispatch` accepts a budget and repeat
count. Default: 180 seconds per engine, two paired repetitions, alternating
engine order, all in one 8-vCPU ARM job. Benchmarks are sequential, not spread
across different machines or run concurrently.

The standalone command used by the workflow is:

```sh
bun scripts/benchmark/fixed-input/runFixedInputBenchmark.ts \
  --jar tmp/freerouting-2.4.1.jar \
  --budget-ms 180000 \
  --repetitions 2 \
  --output tmp/allwinner-fixed-input-benchmark
```

Java 25 is required; `--java /path/to/java` selects an explicit runtime. The
runner rejects any JAR whose SHA256 differs from
`251101c3eeac22d7e7dfcf6796603279e5d1000283eb82d8f093780f7afc6aa9`.
The output directory must not already exist, preventing stale output reuse.
Run focused unit tests locally with `bun test --timeout 9999999` as usual.

## Timing and engine configuration

Each engine starts in a new POSIX process group. A parent monotonic deadline
starts before spawning the worker and includes runtime startup, parsing the
same input, DSN adaptation where needed, solver construction, synchronous
steps, and output serialization. Common preflight (hash checks and environment
collection) and independent scoring are outside the routing budget. A hung
constructor cannot escape the deadline. At expiry the parent kills the whole
process group, including Java; there is no extra routing or export grace period.
Observed elapsed time includes process termination overhead and is recorded.

Native uses `AutoroutingPipelineSolver9_PreloadedTraceGraph`, effort 1, and
`cacheProvider: null`. Freerouting has fanout, optimization, and automatic
neckdown disabled, one routing/optimizer thread, and `max_passes=0` (unlimited),
so the common deadline limits unfinished runs. Native's own pipeline repair phases
remain enabled; this compares these documented engine configurations, not
identical algorithms or equal iteration counts. Each engine can finish or
report failure before its budget is exhausted. No external warm cache is used;
OS and runtime caches are not claimed to be cold. Alternating repeats reduce
order bias, but this single board cannot establish general router superiority.

## Reading results

`comparison.md` provides the table; `comparison.json` records hardware, source
revision/dirty status, runtime versions, input/JAR hashes, options, deadlines,
and per-run scores. `resolved-dependencies.json` and `package.json` preserve the
installed dependency inventory and requested specifications. This repository
disables lockfile generation; a future fresh installation can resolve newer
ranged dependencies, so compare the archived versions before interpreting a
cross-run change. Engine default random choices are not assumed to expose a
common seed API or produce bit-identical repeated outputs.

`completed` means an output was exported in time. It does not mean all nets
connect or that DRC passes. The same `scoreRouting` geometry checker evaluates
both engines' exported copper against the fixed SRJ, independently of native's
`solved` flag or Freerouting's own DRC. It reports all-terminal physical net
connectivity, copper clearances, out-of-bounds copper, widths, vias, and route
length. Review its supported geometric checks in `scoreRouting.ts`; this is
not an electrical, signal-integrity, or manufacturing validation of the PCB.
Violation counts are diagnostic copper-pair counts and depend on how an engine
segments its output. Use connectivity and zero/nonzero DRC as the success
criteria; raw DRC counts are not an engine ranking.

`timed_out` has no connectivity or DRC score. Pipeline 9 only exposes final
output after completing, and Freerouting need not export a session when killed.
The benchmark deliberately does not substitute an empty output or claim the
absence of a final file means zero progress. Native phase transition logs are
diagnostic wall-clock observations, not percentages of connected nets.

Every run preserves logs and any native JSON, DSN, or SES output as an artifact.
Scoring failures remain failures with their error message; they cannot turn
into an apparently clean routing result.
The CLI exits nonzero on infrastructure failure (nonzero external process exit,
worker crash, invalid output, or scoring error), after writing the available
reports. A timeout or native `solver_failed` result is a valid measured
algorithm outcome and does not by itself fail the workflow.
