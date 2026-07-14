---
name: tscircuit-performance-improvement-workflow
description: Dataset- and location-agnostic loop to improve the tscircuit autorouter's solve performance. Primary target is lowering P50 and P95 solve time on a user-chosen dataset, but any rise in solve rate (Completed %) always wins. Asks the user which dataset and where to run (local vs Blacksmith), then drives baseline → idea backlog → one git worktree + subagent per idea → re-benchmark → keep/reject, serializing benchmark runs locally and parallelizing them on Blacksmith CI.
---

# tscircuit performance improvement workflow

Run from the repo root with Bun. Datasets are git deps, so `bun install` must succeed before benchmarking.

## Inputs (ask the user FIRST, record both in `process.md`)
- `<chosen-dataset>` — one of `dataset01|zdwiel|srj05|srj11|srj12|srj13|srj14|srj15|srj16|srj18`. Default `dataset01`.
- `<run-location>` — `local` or `blacksmith`. Selects the concurrency rule (below).

## Keep-rule (defined here once; steps reference it)
Primary goal: lower **P50** and **P95** on `<chosen-dataset>`. Decision ladder for each change:
1. `Completed %` ↑ → **keep**. Overrides everything — keep even if P50/P95/`Relaxed DRC Pass %`/`Avg Via`/avg solve time worsen. More solves always wins.
2. `Completed %` flat → keep only if **P50 ↓ AND P95 ↓** with no regression in solve rate, avg solve time, `Avg Via`, or DRC (`Relaxed DRC Pass %`).
3. Otherwise (`Completed %` ↓, or nothing improved, or a regression with no solve-rate gain) → **reject**.
4. Mixed/ambiguous (e.g. P50 ↓ but P95 ↑, `Completed %` flat) → operator judgment; log numbers + reasoning.

## Concurrency rule (defined here once)
`--concurrency $(( $(nproc)/2 ))` (min 1) caps worker threads **within** one run; never use all cores. Default if unset is full core count, so always set it. Number of runs at once depends on `<run-location>`: `local` → one `./benchmark.sh` at a time (serialize; concurrent local runs corrupt timings and clobber the shared `benchmark-result.*` files); `blacksmith` → parallel runs are fine (each gets its own cloud env).

## Files (repo root; scratch — do NOT commit unless asked)
- `idea.md` — backlog. Each idea: a title, `state` (`tobedone|in-progress|done|rejected`), `hypothesis` (why it lowers P50/P95 or raises `Completed %`), `risk` (what it might regress).
- `process.md` — running log: inputs, commands, raw benchmark numbers, comparisons, decisions.

## Steps
0. Collect Inputs.
1. **Baseline.** Clean checkout of `origin/main`, then benchmark `<chosen-dataset>`; record P50 / P95 / `Completed %` / `Relaxed DRC Pass %` / avg solve time under a "Baseline" heading.
   ```bash
   git fetch origin && git checkout -B perf-baseline origin/main && bun install
   CPUS=$(( $(nproc)/2 )); [ "$CPUS" -lt 1 ] && CPUS=1
   ./benchmark.sh --dataset <chosen-dataset> --concurrency "$CPUS"
   ```
2. **Idea backlog.** Populate `idea.md` with ideas in state `tobedone`.
3. **Per idea, via a subagent.** Mark `in-progress`; the subagent worktrees off `origin/main`, implements, benchmarks `<chosen-dataset>` at the same CPU budget (obeying the Concurrency rule), logs raw results to `process.md`, then applies the Keep-rule: mark `done`, or mark `rejected` (with reason) and discard.
   ```bash
   git worktree add -b perf/<slug> ../ar-<slug> origin/main && cd ../ar-<slug> && bun install
   # implement, then benchmark as in step 1
   # on reject: git worktree remove ../ar-<slug> --force && git branch -D perf/<slug>
   ```
4. **Report.** In `process.md`, summarize baseline-vs-best deltas for `<chosen-dataset>` (`<run-location>` noted): `Completed %` first, then P50/P95, plus `Avg Via`, avg time, DRC.

## Benchmark reference
```
./benchmark.sh [solver|all] [scenario-limit] --concurrency <n> --effort <n> --dataset <chosen-dataset>
```
- Default solver (no positional arg): `AutoroutingPipelineSolver4`.
- Output: stdout table + `benchmark-result.txt` / `benchmark-result.json` (+ HTML snapshot) at repo root.
- Metric map: **P50** → `P50 Time` (`summary[].p50TimeMs`); **P95** → `P95 Time` (`summary[].p95TimeMs`); **solve rate** → `Completed %` (`summary[].completedRateLabel`); **DRC** → `Relaxed DRC Pass %` (`summary[].relaxedDrcRateLabel`).
- No average-solve-time column exists — the only avg shown is `Avg Via` (via count, a quality metric). Derive avg time by averaging `tests[].elapsedTimeMs` from `benchmark-result.json` over succeeded samples.
- Blacksmith only: in a PR, exact `/benchmark` runs dataset01, while exact `/benchmark-all` dispatches separate cloud runs for dataset01, srj18, srj19, srj20, srj21, and srj23. PR comment arguments are unsupported.
