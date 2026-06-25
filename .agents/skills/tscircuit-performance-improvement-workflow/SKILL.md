---
name: tscircuit-performance-improvement-workflow
description: Iteratively improve the tscircuit autorouter's solve performance on dataset01 — primarily lowering p50 and p95 solve time, but treating any rise in solve rate (Completed %) as an outright win even at the cost of p50/p95, DRC, Avg Via, or average solve time. Tracks ideas in idea.md, implements each in an isolated git worktree branched from origin/main via a subagent, benchmarks dataset01 using half the available CPUs (serializing local benchmark runs, parallelizing only on Blacksmith CI), and logs every step in process.md.
---

# tscircuit performance improvement workflow

## Goal
Make the autorouter better on **dataset01**. The primary target is lowering **p50** and **p95** solve time. But there is one overriding rule that beats everything else:

> **Raising solve rate (`Completed %`) is ALWAYS a win, on its own.** Solving MORE samples is always good. Keep any change that increases `Completed %` — even if it does NOT lower p50/p95, and even if it pushes p50, p95, DRC (`Relaxed DRC Pass %`), `Avg Via`, or average solve time UP. "Completed % went up" always tips the decision to KEEP.

The hold-steady constraints only apply **when `Completed %` is unchanged**. In that case you are doing a pure speed optimization, so keep a change only if **p50 ↓ AND p95 ↓** with no regression in:
- solve rate (`Completed %`)
- average solve time
- `Avg Via`
- DRC (`Relaxed DRC Pass %` — no new design-rule-check violations, no drop in DRC quality)

Mixed / ambiguous trade-offs (e.g. `Completed %` flat, p50 down but p95 up) are a judgment call for the operator — log the numbers and reasoning in `process.md`. Discard a change only when nothing improved, or when there is a regression with no accompanying gain in `Completed %`.

## Conventions
- Baseline first: always capture a baseline on dataset01 before changing any code.
- dataset01 only: do not run other datasets unless explicitly instructed. dataset01 is already the benchmark default, but pass it explicitly (`--dataset dataset01`) so runs are unambiguous.
- CPU budget: use floor(nproc/2) by default (min 1). Never use all CPUs unless explicitly instructed. The exact knob is the `--concurrency N` flag on `./benchmark.sh` (equivalently the `BENCHMARK_CONCURRENCY` env var). Its default is the full core count (`os.cpus().length`), so you MUST set it. This `--concurrency` is the worker-thread count *within a single run*; it is NOT about how many runs execute at once (see next bullet).
- Serialize local benchmark runs: on the local machine, run only ONE `./benchmark.sh` process at a time. Ideas are implemented in parallel worktrees by subagents, but the benchmark *executions* must be serialized locally — queue them and run one after another. Two concurrent local runs would fight over the same cores and corrupt each other's timings (and overwrite the shared `benchmark-result.*` files in the repo root). `--concurrency` (= `$(( $(nproc)/2 ))`) still controls threads inside that single run.
- Blacksmith CI is the exception: on Blacksmith cloud runners, benchmarks MAY run many-at-once in parallel because each run gets its own isolated cloud environment (and its own cores). So the subagent-per-idea fan-out can dispatch all the Blacksmith benchmark runs in parallel, but must still serialize any runs that happen on the local machine.
- Branch from origin/main: every implementation worktree starts at origin/main unless instructed otherwise.
- One idea → one git worktree → one subagent.

## Files this workflow maintains (at repo root of the working copy; scratch — do NOT commit unless asked)
- `idea.md` — idea backlog. Each idea has a state: `tobedone`, `in-progress`, `done`, `rejected`.

  Example idea block:

  ```md
  ## Cache region spatial index across pipeline phases
  - state: tobedone
  - hypothesis: The spatial index is rebuilt per phase; reusing it should cut the per-sample setup time that dominates the median, lowering p50 (and p95 on the heavier samples).
  - risk: A stale/shared index could change routing decisions and regress solve rate or introduce DRC violations on dense BGA samples.
  ```

- `process.md` — running log of intermediate process: commands run, raw benchmark numbers, comparisons, decisions, per-idea notes.

## Steps

1. **Baseline.** Fetch origin, check out a clean `origin/main`, compute the CPU budget, run the dataset01 benchmark with that budget, and record p50 / p95 / solve-rate / DRC / per-sample timings into `process.md` under a "Baseline" heading.

   ```bash
   git fetch origin
   git checkout -B perf-baseline origin/main
   bun install                                 # required: datasets are git deps
   CPUS=$(( $(nproc) / 2 )); [ "$CPUS" -lt 1 ] && CPUS=1
   ./benchmark.sh --dataset dataset01 --concurrency "$CPUS"
   ```

   The run writes `benchmark-result.txt` and `benchmark-result.json` (and an HTML snapshot) to the repo root. Copy the P50 Time, P95 Time, Completed % (solve rate), and Relaxed DRC Pass % values from the printed table into `process.md`, and capture the per-sample `elapsedTimeMs` array from `benchmark-result.json` (used to derive the average — see "Benchmark command reference").

2. **Idea backlog.** Create/update `idea.md` with ideas in state `tobedone`, each with a hypothesis (why it should lower p50/p95 — or raise `Completed %`) and a risk (what it might regress).

3. **Implement each `tobedone` idea via a subagent.** For each idea:
   - mark it `in-progress` in `idea.md`
   - the subagent creates a git worktree branched from `origin/main`, implements the idea, and benchmarks dataset01 at the same CPU budget. Run the benchmark on Blacksmith CI where multiple ideas' runs can proceed in parallel; if running locally, queue it so only one `./benchmark.sh` runs at a time (see Conventions):

     ```bash
     git fetch origin
     git worktree add -b perf/<idea-slug> ../ar-<idea-slug> origin/main
     cd ../ar-<idea-slug>
     bun install
     # ...implement the idea...
     CPUS=$(( $(nproc) / 2 )); [ "$CPUS" -lt 1 ] && CPUS=1
     ./benchmark.sh --dataset dataset01 --concurrency "$CPUS"
     ```

   - the subagent appends raw results (the table + the relevant `benchmark-result.json` figures) and intermediate process notes to `process.md`, and compares against the baseline.
   - **Decision rule** (see "Goal" for the full statement):
     1. **`Completed %` went UP → KEEP**, mark `done`. This overrides everything — keep it even if p50/p95/`Avg Via`/DRC/avg solve time got worse. Solving more samples always wins.
     2. **`Completed %` unchanged → speed test:** keep & mark `done` only if **p50 ↓ AND p95 ↓** with no regression in solve rate, average solve time, `Avg Via`, or DRC.
     3. **`Completed %` went DOWN, or nothing improved, or a regression with no completion gain → `rejected`** (with a reason).
     4. **Mixed/ambiguous** (e.g. p50 ↓ but p95 ↑, `Completed %` flat) → operator judgment call; record the numbers and reasoning in `process.md`.

     When marking `rejected`, discard the worktree:

     ```bash
     git worktree remove ../ar-<idea-slug> --force
     git branch -D perf/<idea-slug>
     ```

4. **Report.** Summarize baseline-vs-best deltas in `process.md`: `Completed %` change first (the headline — any gain is the win), then p50 and p95, plus `Avg Via`, average solve time, and DRC, noting for each kept change whether it was a solve-rate win or a steady-state speed win.

## Benchmark command reference

All commands are run from the repo root with Bun (this repo is Bun-only). The dataset packages are installed as git dependencies, so `bun install` must succeed before benchmarking.

**Entry point.** `./benchmark.sh` is the canonical runner. It wraps `bun scripts/benchmark/index.ts` and, with no solver argument, benchmarks the default solver `AutoroutingPipelineSolver4` (`DEFAULT_SOLVER_NAME` in `benchmark.sh`).

Invocation shape:

```
./benchmark.sh [solver-name|all] [scenario-limit] --concurrency <n> --effort <n> --dataset <dataset01|zdwiel|srj05|srj11|srj12|srj13|srj14|srj15|srj16|srj18|srj19|srj20>
```

The first two positional args are an optional solver name (or `all`) and an optional scenario limit. For this workflow, leave the solver unset (defaults to `AutoroutingPipelineSolver4`) unless told otherwise.

**Running via the PR `/benchmark` bot.** In a PR, comment `/benchmark ...`; the bot forwards everything after `/benchmark` directly to `./benchmark.sh`. So the dataset01 / half-CPU run is, e.g., `/benchmark --dataset dataset01 --concurrency <n>`. (Bot example for context: `/benchmark all 20 --dataset dataset01 --concurrency 8` runs all solvers, 20 scenarios, dataset01, 8 workers.)

**dataset01 only.** Use the exact flag/value `--dataset dataset01`. dataset01 is also the default, and the runner additionally accepts the aliases `1`, `01`, `dataset1` (from `scripts/benchmark/scenarios.ts`), but prefer `dataset01`.

```bash
./benchmark.sh --dataset dataset01 --concurrency "$CPUS"
```

To restrict to specific samples within dataset01 (1-based indices into dataset order): `--sample-numbers 1,2,3`. To cap the number of scenarios: `--scenario-limit N`. Do not pass these unless asked — the default runs the whole dataset.

**CPU / concurrency knob.** Number of Bun worker threads per solver:
- Flag: `--concurrency N` (or `--concurrency auto`, which resolves to the full core count).
- Env var: `BENCHMARK_CONCURRENCY=N ./benchmark.sh ...`.
- Default if unset: full core count (`os.cpus().length` in `scripts/benchmark/index.ts`; `getconf _NPROCESSORS_ONLN`/`nproc` in `benchmark.sh`).
Set it to `floor(nproc/2)` (min 1) — i.e. `--concurrency $(( $(nproc) / 2 ))`:

```bash
CPUS=$(( $(nproc) / 2 )); [ "$CPUS" -lt 1 ] && CPUS=1
./benchmark.sh --dataset dataset01 --concurrency "$CPUS"
```

**Where the metrics are reported.** The run prints a results table to stdout and writes `benchmark-result.txt`, `benchmark-result.json`, and an HTML snapshot to the repo root. The stdout/`.txt` table columns are:

```
| Solver | Completed % | Relaxed DRC Pass % | Timed Out | P50 Time | P95 Time | Avg Via |
```

- **p50** → `P50 Time` column (JSON: `summary[].p50TimeMs`). p50 of elapsed time over *succeeded* samples.
- **p95** → `P95 Time` column (JSON: `summary[].p95TimeMs`). p95 of elapsed time over *succeeded* samples.
- **solve rate / solved count** → `Completed %` column (JSON: `summary[].completedRateLabel`). Also visible in the per-sample stdout lines: `[<solver>] <rate>% success (<solved>/<completed>) ...`.
- **DRC** → `Relaxed DRC Pass %` column (JSON: `summary[].relaxedDrcRateLabel`). New DRC violations also surface in the "Top failure buckets" / "relaxed DRC" failure summary printed after the table, and per-snapshot in `benchmark-result.json` (`tests[].relaxedDrcPassed`, `tests[].drcErrorTypes`).

**Average solve time — caveat (verified against source):** the benchmark does NOT print an "average solve time" column. The only average column in the table is **`Avg Via`** (mean via count of solved samples — a routing-quality metric, not a timing one). To hold "average solve time" steady, compute it yourself from the per-sample elapsed times: each scenario prints its time on its progress line (`... <scenario> <time>`), and every sample's `elapsedTimeMs` is stored in `benchmark-result.json` under `tests[]`. Average those `elapsedTimeMs` values (over the same set of succeeded samples) for baseline and for each idea, and record both in `process.md`.

> Note for whoever runs this: the only place an explicit mean-solve-time number is emitted is whatever you derive from `benchmark-result.json` `tests[].elapsedTimeMs`; there is no built-in average-time label to copy from the table.
