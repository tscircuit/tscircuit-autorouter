# Pipeline 9 independent-route heuristic experiment

This change enables the existing lazy heuristic option only in
`DuplicateCongestedPortSolver.routeSolveOptions`. Each independent route used
to evaluate a distance for every graph port, although search requests far fewer
values. Main selective-rerip and section search options remain unchanged.

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
