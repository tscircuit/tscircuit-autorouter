# Pipeline 9 independent-route heuristic experiment

This change enables the existing lazy heuristic option only in
`DuplicateCongestedPortSolver.routeSolveOptions`. Each independent route used
to evaluate a distance for every graph port, although search requests far fewer
values. Main selective-rerip and section search options remain unchanged.

## Algorithmic invariant and work reduction

This replaces O(R × P) eager distance-table construction with O(Q) demand
computations, where R is the number of independent routes, P the loaded port
count and Q all actual heuristic requests, including repeated ports. There is
no universal Q < R × P guarantee and no search path is pruned. Coordinates,
route endpoint and distance scale remain immutable for each independent solve;
therefore the queue receives the same rounded values and retains tie order.

Each distance expression executes two subtractions, three multiplications,
one addition and one `Math.sqrt`, in the unchanged order. Across the measured
five inputs this is 88,272,135 → 1,793,190 source-level arithmetic evaluations,
including 12,610,305 → 256,170 square-root calls. These are algorithmic counts,
not CPU instruction counts. They exclude candidate-table indexing, coordinate
loads and other solver work; they do not imply faster elapsed time. No JIT
configuration or engine-specific code path changes.

## Measured result and limits

Five fixed SRJ18 inputs at effort 1 required **12,610,305 → 256,170** distance
calculations in the duplicate-port prepass (97.97% fewer). Summed heuristic-buffer
allocation fell by **100,882,440 bytes** across the five boards. This is cumulative
allocation avoided, not a measured reduction in peak heap or process RSS.

| Sample | Eager evaluations | Lazy evaluations | Avoided buffer bytes | Prepass median ms, eager → lazy |
| --- | ---: | ---: | ---: | ---: |
| 1 | 2,596,325 | 44,954 | 20,770,600 | 293.70 → 279.60 |
| 2 | 4,651,128 | 86,930 | 37,209,024 | 417.21 → 431.27 |
| 3 | 2,119,030 | 54,028 | 16,952,240 | 227.37 → 236.41 |
| 4 | 869,706 | 30,018 | 6,957,648 | 133.35 → 143.44 |
| 5 | 2,374,116 | 40,240 | 18,992,928 | 173.85 → 186.00 |

Three alternating eager/lazy runs used separate Bun processes. A later drift-check
pair reproduced all hashes and counts; its eager/lazy per-case timings are retained
in the JSON evidence. All six graph
and duplicate-report hashes matched for each input. Timings include identical
counter instrumentation. Four prepass medians increased: **this is not evidence
of a runtime speedup**. The demonstrated benefit is reduced heuristic computation
and allocation, with that runtime tradeoff explicitly retained in the evidence.

The prescribed full-pipeline benchmark completed 4/5 boards in both modes;
sample 2 timed out downstream at the 60-second cap. All completed boards passed
relaxed DRC and had identical via counts (174, 90, 136, 146). All five pathing
`routingMetrics` matched after excluding timing fields. Whole-pipeline P50 was
7,694.97 → 7,783.82 ms and P95 was 54,564.91 → 54,789.89 ms. This bounded run
checks completion/quality regressions; it does not establish elapsed-time benefit
or statistical equivalence. No claim is made about untested boards.

## Reproduction

- Autorouter baseline: `34dc48b0bec14d802eda5936f0bd76a426a41136`.
- tiny-hypergraph: `31459ceef75e443d3ea6efca75cde10b90d63180` (unchanged).
- SRJ18 dataset: `100e8957ce789b5b288e14c476dc83f4efc5214b`.
- Bun 1.3.14, macOS 27.0 arm64 on Apple M5; serial runs, no concurrent benchmark workloads.
- The only production-source candidate delta is enabling the prepass option.
- Raw compact results and output hashes: `pipeline9-lazy-prepass-results.json`.

The experiment CLI overrides only the prepass option, so both variants can be
measured from the candidate revision:

```sh
bun install --frozen-lockfile
bun scripts/benchmark/measure-pipeline9-prepass-heuristic.ts
bun scripts/benchmark/measure-pipeline9-prepass-heuristic.ts --lazy
# Repeat the pair three times, preserving each JSONL output.
```

Whole-pipeline command, run once per production-source variant:

```sh
./benchmark.sh --pipeline 9 --dataset srj18 --sample-numbers 1,2,3,4,5 \
  --effort 1 --sample-timeout 60s --concurrency 1
```

## Lean and implementation scope

```sh
lean proofs/LazyPrepassHeuristic.lean
bun test tests/tinyhypergraph-lazy-prepass-heuristic.test.ts --timeout 9999999
bunx tsc --noEmit
```

Lean 4.28.0 checks tabulated lookup versus demand evaluation, deterministic
bounded-search trace equivalence, conditional distance-evaluation savings, and
heuristic-buffer allocation. No `sorry`, `admit`, or custom axioms are used.
See `../../proofs/lazy-prepass-heuristic.md` for the TypeScript mapping and
unverified language/runtime boundary. The two branches use identical binary64
operations, endpoints, and operation order. The proof does not replace them
with real arithmetic or change tie-breaking; it does not prove global routing
optimality or a runtime bound.

## Historical context, not a controlled comparison

Existing run [36263365509, attempt 1](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/36263365509/attempts/1)
in `tscircuit/tscircuit-autorouter` used the same autorouter base SHA. Its SRJ19
artifact covers samples 1–200 at effort 1, with 32 workers on
`blacksmith-32vcpu-ubuntu-2404-arm` and a 360-second cap: 181 completions,
19 timeouts, 144 relaxed DRC passes, P50 28.186 seconds, P95 360 seconds.
Existing logs/artifacts were reused from the shared download cache. These
concurrent ARM measurements are historical context, not a speedup baseline.
Pipeline stage clocks start after construction and omit the synchronous
independent-route prepass; this experiment instruments that prepass explicitly.

## Matched warm browser and Bun prepass checks

Real headless Chromium **151.0.7922.34 / V8 15.1.206.8** ran the same captured
Pipeline 9 prepass graphs/options as Bun 1.3.14. Each engine ran serially, with
two warmup rounds followed by five measured rounds and rotating variant order.
Every run used a fresh solver; explicit GC preceded the solve, and output
hashing was outside its timer. No computer-use automation or CI was involved.
This is a browser prepass measurement, not a Node/V8 proxy.

| SRJ18 sample | Chromium median ms, eager → lazy | Warmed Bun median ms, eager → lazy |
| --- | ---: | ---: |
| 1 | 284.0 → 283.8 | 212.33 → 215.45 |
| 2 | 485.2 → 475.0 | 374.52 → 364.26 |
| 3 | 276.9 → 272.1 | 216.12 → 212.71 |
| 4 | 159.3 → 155.3 | 125.91 → 118.72 |
| 5 | 247.5 → 237.6 | 159.90 → 157.48 |

The exact operation counts, table-allocation counts and graph/report hashes
match across variants on all five cases within each engine. Cross-engine byte
identity is not claimed: the sample-3 and sample-4 prepass baseline hashes differ between
Chromium and Bun, and this experiment does not establish its cause. Chromium medians were
0.1–4.0% lower, while Bun had one small regression. These descriptive results
support engine-independent algorithmic applicability, not a universal elapsed
time guarantee. Earlier fresh-process and these warmed measurements use
different protocols and must not be pooled.

Chromium `performance.memory.usedJSHeapSize` and Bun `heapStats().heapSize`
were recorded before, immediately after, and after GC retaining the solver.
Retained heap stayed approximately flat; no retained-memory, peak-memory or RSS
improvement is claimed. The cumulative eliminated heuristic-buffer allocations
remain 100,882,440 bytes. Heap counters from different engines are not directly
comparable. Compact raw timings, counters, hashes and heap samples are in
`pipeline9-lazy-prepass-runtimes.json`.

The shared portable harness is preserved in
[tiny-hypergraph PR #214](https://github.com/tscircuit/tiny-hypergraph/pull/214),
at harness commit `2dd34b93e8a53361ba0da159ebfddbd053011349`. Its
[README](https://github.com/tscircuit/tiny-hypergraph/blob/2dd34b93e8a53361ba0da159ebfddbd053011349/scripts/benchmarking/boundary-runtime/README.md) documents captured-input
reuse, exact consumer/owner snapshots, and the installed `CHROMIUM_PATH`.
From that package checkout, use:

```sh
bun scripts/benchmarking/boundary-runtime/prepare.mjs \
  /path/to/tiny-hypergraph /path/to/tscircuit-autorouter /tmp/pipeline9-browser
bun /tmp/pipeline9-browser/capture-inputs.mjs /path/to/tscircuit-autorouter /tmp/pipeline9-browser
CHROMIUM_PATH=/path/to/chrome-headless-shell bun /tmp/pipeline9-browser/run-browser.mjs /tmp/pipeline9-browser
bun /tmp/pipeline9-browser/run-bun.mjs /tmp/pipeline9-browser
CHROMIUM_PATH=/path/to/chrome-headless-shell bun /tmp/pipeline9-browser/run-browser.mjs /tmp/pipeline9-browser --full
CHROMIUM_PATH=/path/to/chrome-headless-shell bun /tmp/pipeline9-browser/run-browser.mjs /tmp/pipeline9-browser --full-lazy
```

Run timing commands serially. The full harness uses a cooperative 60-second
step-loop deadline, which cannot interrupt a single long synchronous step;
the prescribed Bun worker benchmark uses a stronger worker timeout. The first
measurements used equivalent scratch scripts; the preserved harness normalizes
paths and metadata without changing recorded timing rows.

## Full Pipeline 9 in Chromium

The real Pipeline 9 browser bundle also completed SRJ18 samples **1, 3 and 5**
at effort 1 with a 60-second cap. Baseline and lazy full SRJ output SHA256 hashes,
via counts and planar wire lengths matched exactly. The existing
`evaluateRelaxedDrc` evaluator reported **zero errors for all three** in both
variants. These runs include downstream routing, not just the prepass.

| Sample | Baseline ms | Lazy ms | Vias, both | Planar wire length, both |
| --- | ---: | ---: | ---: | ---: |
| 1 | 9,072.7 | 9,096.6 | 174 | 2,219.790072 |
| 3 | 6,266.3 | 7,614.6 | 90 | 890.127264 |
| 5 | 7,444.5 | 6,950.9 | 146 | 1,993.979299 |

This was a bounded correctness sweep: one measured run per variant/case after
sample-1 warmup. Lazy ran in a separate browser session after the baseline and
sibling boundary-index sweep. This unmatched schedule and mixed timings do not
support an end-to-end speedup claim. DRC and hashing were outside the solve
timer. Browser samples 2 and 4 were not rerun end-to-end; all five did run in the
repeated browser prepass comparison. The raw full-pipeline rows, output hashes,
reported before/after heap values and protocol are in the runtime JSON.

## Fresh-main applicability

A fresh `git fetch origin main` on 2026-09-28 confirmed autorouter main is still
`34dc48b0bec14d802eda5936f0bd76a426a41136`, exactly the controlled baseline above.
PR #2757 is open and the option remains disabled on main. The current consumer
pin is still `31459ceef75e443d3ea6efca75cde10b90d63180`; no dependency bump or
branch rewrite was needed. The dependency owner's main is audited separately by
the sibling change; its new fixes are not silently substituted for this pin.
