# Held Dataset18 published-pair diagnostic

Prepared only. Do not push this branch until native physical publication gain qualifies the diagnostic and root reviews the frozen harness. A branch-specific push then runs one paired job; there is no manual-dispatch dependency or preparation-only approval flow. No local install, build, routing, commit or push was performed.

The routing baseline is exact published AR 1107 from the frozen Main 3200/Core 2395/Eval 1789 package graph. The diagnostic is the same package with one ASCII `2`→`4` byte at offset 2109350, changing the existing solveGraph allowance coefficient. It is not a proposed production fix. Every existing effort/graph-size, portfolio, parent and conditional final-child formula remains intact and propagates that one allowance change. No live-reachability, heuristic, KD, obstacle or bus-antipad change is included.

- Baseline entry SHA256: `52eea6a8b25d4af91da1c92790d9c80f674e6ed1aecbf1344738c133033e6310`.
- Diagnostic entry SHA256: `baac86bb722ab1ef19d025655ce22ca5a5ae523dedcedd6cb69b483059fddb40`.
- Evaluation/controller source: AR 1107 gitHead `6d2cf24aea553928628036aceaa8f43ed3026e73` in both lanes.
- Original Dataset18: 16 cases, dependency commit `100e8957ce789b5b288e14c476dc83f4efc5214b`.

## Actual routing boundary

The standard source benchmark imports routing from `../../lib`. Merely changing the runtime alias would silently test source AR. Preparation replaces the same three imports in two benchmark files, then generates a per-lane `selected-autorouter.mjs` that re-exports the absolute, hash-verified published/private AR entry. The measured P9 constructor must be that exact export. All production source files and all DRC, conversion, linter, scenario, timing and scheduling helpers remain unchanged. The common source helper code is intentionally executed; this is not a claim that every evaluated module comes from npm.

Both published/private AR packages share the original frozen routing-dependency link and unchanged sibling assets. No global runtime alias is retargeted. The unchanged 3200 bootstrap runs first and proves the four canonical package entries. A separate evaluation/development graph is resolved **once** on CI at the exact source revision, saved to a text lock and fully inventoried, then copied unchanged to the other lane. The original `bunfig.toml` remains unchanged; only installation uses the proven private lock-saving config. Sharp is initialized before inventory/copy. This graph supplies Dataset18 and existing testing helpers, not the routing constructor. No old Tiny/source-build artifact or old source lock is reused as a routing baseline.

Before measurement, separate child processes import each selected AR entry, load/hash all 16 original scenarios, and construct the first scenario's P9 instance without stepping it. Constructor identity, native effort 1, input equality and graph equality must pass. Both AR builds are never imported into the same process, preserving the existing solver registry contract. After measurement, entry, dependency, common harness and original package hashes must still match.

## Commands and resources

The workflow is `.github/workflows/dataset18-budget-diagnostic-3200.yml`. It uses one `blacksmith-8vcpu-ubuntu-2404-arm` VM, Bun 1.4.3, sequential base then diagnostic passes, and a 120-minute job allowance. Each case keeps its 360-second timeout, original effort and geometry/DRC rules. Requested concurrency is 4 and threads per sample 1. The existing 6-GiB-per-worker guard remains unchanged; previous 25.15-GB ARM jobs selected 3 actual workers. Both requested and actual counts are reported and must match between passes for a fair timing comparison.

```bash
python3 experiments/full-board-ten/bootstrap.py --root "$RUNTIME_ROOT"
python3 experiments/dataset18-budget-diagnostic-3200/prepare-pair.py --workspace "$GITHUB_WORKSPACE" --runtime-root "$RUNTIME_ROOT"
BENCHMARK_DATASET=srj18 BENCHMARK_ARGS_JSON='["--pipeline","9","--dataset","18","--concurrency","4","--threads","1","--sample-timeout","360s"]' bun same-machine-base/scripts/benchmark/runSameMachineBenchmarks.ts
python3 experiments/dataset18-budget-diagnostic-3200/prepare-pair.py --workspace "$GITHUB_WORKSPACE" --runtime-root "$RUNTIME_ROOT" --verify-only
```

The existing `same-machine-results.ts` renders the normal comparison. `report-pair.py` prints per-case completion, relaxed DRC issue counts, timeouts, vias, lint, elapsed time, peak RSS, complete/partial stage timing, errors and new regressions to ordinary logs; it appends the comparison to the job summary. Full normal reports/snapshots and fresh graph proofs are scoped artifacts, with hidden-path upload enabled. Missing lanes and changed allocation/provenance fail explicitly. Quality regressions remain visible data for review; a valid benchmark pair is not an approval to ship a diagnostic allowance.

Expected CI time is roughly 20–30 minutes including dependency setup, based on prior paired Dataset18 jobs. If all 16 one-effort cases reach the unchanged timeout with 3 workers, the two passes can take about 72 minutes before setup/reporting; the 120-minute job allowance leaves room. These are estimates. A single base-first pair has order/noise limits. This does not validate native all-terminal/pour connectivity, add a wire-length metric, or establish a speedup. Threads stay 1, so generated solver-worker variants are not part of this routing experiment.

Static preflight covers Python/JS/YAML syntax, current AR 1107 import anchors, exact single-byte adapter output/reapply rejection, unchanged bootstrap/locks, fixed settings and scoped artifacts. The CI dependency install and constructor/fixture identity probe have not run locally; no full local solve was performed.
