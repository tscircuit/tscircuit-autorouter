# SRJ18 / Pipeline9 detailed profiling

Run from the repository root after installing dependencies with Bun:

```sh
bun scripts/profile-srj18.ts --out-dir results/srj18-pipeline9
bun scripts/summarize-srj18.ts results/srj18-pipeline9
bun scripts/summarize-srj18-cpu.ts results/srj18-pipeline9
```

The default run uses all SRJ18 sample IDs, effort 1, three baseline repetitions,
one detailed run and one native CPU profile per sample, followed by report generation. Work is sequential;
each sample/repetition uses a new process and therefore starts with fresh
process-local caches. The second baseline pass reverses the sample order.
Use a new output directory when repeating a mode. The script refuses to overwrite
an existing phase directory so stale and new measurements cannot be mixed.

```sh
# One sample, including baseline, detailed records and CPU profile
bun scripts/profile-srj18.ts --sample 2 --out-dir results/srj18-sample002

# Only baseline timing, or only a detailed/native CPU pass
bun scripts/profile-srj18.ts --mode baseline --limit 3 --repeats 5
bun scripts/profile-srj18.ts --mode detailed --sample 2
bun scripts/profile-srj18.ts --mode cpu --sample 2

# A CPU-only profile with a wider sampling interval and lower memory use
bun scripts/profile-srj18.ts --mode cpu --sample 2 --cpu-interval-us 10000 --cpu-smol

# All available options
bun scripts/profile-srj18.ts --help
```

## What is measured

The baseline timer starts before Pipeline9 construction and stops when routing
solves, fails, or throws. Input loading, module imports, output conversion,
external relaxed DRC validation, serialization and process teardown are outside
that timer. Process logs additionally include the whole child-process duration.
Routing CPU user/system time and output/validation durations are separate fields.
The baseline still performs outer stage/node timing and bookkeeping. Its
overhead relative to a plain `solve()` call has not been isolated; it is the
comparison baseline for this harness, not a claim of zero measurement overhead.

Each stage accumulates the wall time of its Pipeline9 steps. This includes the
step which prepares constructor arguments and constructs the stage, as well as
the completion callback. Pipeline9's own `timeSpentOnPhase` begins after stage
construction, ends before the callback, includes time between driver steps, and
is not finalized on failure. Both measurements are saved. Their difference is
not a pure constructor-time measurement because the timer boundaries differ.

Each high-density node accumulates the steps that prepare and route it, including
all portfolio attempts and retries. Every available node is listed, with its
coordinates, dimensions, port count, connection count and node Pf. Nodes/stages
that routing never reaches are explicitly distinguished from completed work.

The detailed run builds a temporary instrumented bundle. A TypeScript syntax
parser inserts synchronous timing scopes into class `step`, `_step`, `solve`,
`setup` and `_setup` methods, and around `new` expressions whose constructor
expression contains "solver". This also instruments dependency source. It does
not replace prototypes or edit routing source or installed dependency files.
The instrumented source inventory and original source hashes are saved.

The profiler records parent IDs, node IDs (inherited where necessary), method
calls, constructor calls, cumulative inclusive/self time and maximum call time.
It snapshots scalar settings and solver state at construction and observed
terminal steps, and tracks iterations/progress at step exit. The profiler stores
snapshots and weak object keys rather than retaining completed solver objects.

## Reading the detailed records

- **Self time** subtracts nested instrumented calls and can be summed without
  counting a child twice. It includes uninstrumented helpers called by that
  scope, and some instrumentation overhead.
- **Inclusive time** includes children. Do not sum inclusive parent and child
  times. A solver's inclusive duration removes overlapping calls on the same
  record; method-level inclusive durations intentionally retain call nesting.
- **Construction self time** includes argument evaluation, constructor bodies
  and initializers except nested instrumented calls. A constructor can call
  `setup`/`step` before it returns. In that case construction and lifecycle can
  appear as two linked records for one object; use construction-call counts,
  not record counts, when counting constructed candidates.
- **step calls** include calls on an already terminated solver. Compare against
  actual `iterations`; the portfolio scheduler can continue a fixed batch after
  its candidate has already finished.
- **State fields** are last observed snapshots, not a promise to observe direct
  property changes made by a parent after the child's last measured call.
  An unfinished or zero-step record does not, by itself, prove a failed attempt.
- **Snapshot coverage** is scalar fields, not every private object or search
  frontier. Methods outside the lifecycle are covered by native CPU sampling.
- Per-node reporting can infer the node of a `HighDensitySolver` or
  `Pipeline9RegionalFallbackSolver` wrapper when all its observed node-bearing
  descendants have the same ID. Those wrappers are created for one node in
  Pipeline9. Inferred assignments are labeled in per-record CSVs; raw profiles
  remain unchanged. Regular-path growth counts and growth recorded across
  regular/regional attempts are separate columns.
- The instrumented run has measurable overhead and is bundled. Compare output
  hashes and outcomes with the baseline before interpreting it. Never present
  instrumented elapsed time as production benchmark latency.

Native CPU profiles use Bun's 1 ms sampling interval on the original source.
`--cpu-interval-us` changes the interval. `--cpu-smol` enables more frequent
garbage collection only for the CPU run. Both settings are saved in the manifest;
they can change CPU proportions, so compare like-for-like when evaluating work.
They cover the whole process, including import/validation/output work. Use call
ancestry to distinguish routing functions from post-routing validation. Sampling
does not give exact timings for very short functions or constructors.
CPU frame line numbers are runtime-reported positions and may refer to transpiled
code. Confirm the matching source or source map before editing a reported line.

## Outputs

- `manifest-*.json`: upstream commit, branch, runtime, machine, selection,
  effort, repetitions and cache policy.
- `dependencies.json` and `instrumented/loaded-sources.json`: installed package
  metadata and hashes of loaded source. The repository disables saving Bun
  lockfiles; an independent install can resolve different compatible versions.
- `baseline-N/sampleNNN.json`: baseline timings, node timings, output hashes,
  solver outcome and relaxed DRC errors.
- `detailed/sampleNNN.json.gz`: nested solver and method records plus the same
  stage/node/output information.
- `cpu/sampleNNN/`: gzip-compressed native CPU profiles; decompress a
  `.cpuprofile.gz` to open it in a browser's performance profiler. The adjacent
  JSON is the timed run. Native files are compressed after process exit.
- `solver-records/sampleNNN.csv.gz`: per-record exported timings and metadata.
- `samples.csv`, `stages.csv`, `nodes.csv`, `classes.csv`, `nodeSolvers.csv` and
  `summary.json`: summaries produced by `summarize-srj18.ts`.
- `sampleStages.csv` contains every stage on every board. `summary.md` includes
  the measured tables. `cpu-functions.csv` separates whole-process samples from
  samples with a solver `step` in their ancestry; inclusive function times
  deduplicate recursion within a sample.
- `report.html`: a local interactive table report with filtering, sorting and
  node-to-solver drilldown. A manually authored `detailed-report.md` can accompany
  it to explain the observed hotspots; the benchmark does not invent findings.

P50 is a median. P95 uses nearest rank across per-sample medians. For a 16-board
dataset, that P95 is the largest sample median. Overall timing statistics include
time to failure; they must not be described as successful-routing latency.

The hard timeout terminates a child process after 1,800 seconds by default and
saves an explicit process-failure record. No partial timeout is silently counted
as a solve. A thrown routing error produces a nonzero child exit status; ordinary
solver failure remains an explicit failure in the sample JSON. Later samples
still run so an entire dataset can be characterized.

Detailed JSON is compressed before writing to avoid a large uncompressed disk
file. Serialization, compression and file writes occur after measurement.
Bun can rename bundled runtime classes to avoid collisions: for example,
`HighDensitySolverA012` is the runtime label for source class
`HighDensitySolverA01`. Raw method `owner` fields retain source paths and declared
class names, so similarly named classes can be distinguished without guessing.

The first development measurement schema multiplied Darwin `maxRSS` by 1,024,
following Node's KiB convention. Bun 1.3.9 exposes bytes on Darwin. Schema 2 fixes
this; the summarizer normalizes older Darwin records without changing raw files.
