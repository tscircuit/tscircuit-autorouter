This is the separately versioned followup resource protocol. The frozen original three-lane cohorts remain distinct evidence. The worker is byte-for-byte unchanged. Default driver concurrency is three; a request above the observed affinity count or numeric cgroup CPU quota is rejected. On generous-memory CI with at least six effective CPUs, the paired controller uses six identical pinned lanes for BOTH revisions; otherwise it uses three. Per-pass concurrency, affinity, effective CPU count and memory policy are explicit in metadata. Missing quota observations remain unavailable, not an invented numeric quota.

This harness measures Pipeline 9 on datasets 18 and 24, effort 1, a 360-second full-sample wall limit, and a fresh Bun process per sample. It invokes the repository's existing `runTask`, including relaxed DRC and trace lint. It omits the SVG payload from saved results and adds wire length, output/trace hashes, HD counters, and captured HD-stage constructor inputs. Some wire-length calculations can be nonfinite and exported as null; report only common-finite paired values, with coverage, rather than treating missing values as zero.

Run from a checkout with dependencies installed. Python 3, Bun, and `taskset` are needed for the commands below. Create sibling worktrees named `control` and the experiment name under a directory of your choice; all worktrees need their dependencies. The baseline commit used for this experiment is `637b6c581128238f6c61227a1c15be423d24baca`. The supported experiment names are `portfolio`, `kernel`, `legalization`, `corridors`, and `compatibility`.

For example, with a `control` and `kernel` worktree under `/tmp/hd-experiments`:

```bash
python3 experiments/hd-research/harness/run_matrix.py \
  --worktree-root /tmp/hd-experiments \
  --out /tmp/hd-kernel-results \
  --variants control,kernel \
  --datasets srj18,srj24 \
  --concurrency 2 --cpus 0,1

python3 experiments/hd-research/harness/summarize.py /tmp/hd-kernel-results
```

Choose CPUs from the current process's allowed affinity. CPU pinning is optional; omit `--cpus` on a machine without `taskset`. The managed local machine has a four-core CPU quota, allowed CPU IDs 0–4, and 16 GiB RAM, so it rejects more than four sample lanes. The default local memory-reservation budget remains 13 GiB with a separate 12 GiB current-RSS launch guard. Neither limits an individual solver's allocation. The larger CI profile retains the exact same 48 GiB global memory admission policy even with six lanes. Other coding/test processes can still affect CPU and memory despite sample affinity.

Dataset24 has much larger late-run memory peaks than a short HD prefix suggests. Historical full-sample measurements reached 10.47 GiB on sample004 and 12.30 GiB on sample024; the fresh sample001 control reached 9.21 GiB. Samples001,004,024 therefore reserve the entire admission budget and run alone. Capped samples003,011,018 reserve at least 8 GiB each. Other samples reserve the maximum observed historical/fresh full-process peak multiplied by1.5, plus0.5GiB, rounded up to0.25GiB, with a1.25GiB minimum. A conservative estimate is an admission heuristic, not a proven upper bound on a new algorithm's memory.

`memory-reservations.json` includes every measured source and the per-sample estimates. The driver records that policy's SHA-256, its scheduler hash, reservation size, exclusivity and budget in invocation/task provenance. If a running child exceeds its reservation, its greater observed RSS is charged for further admissions. Reservations are acquired before process startup yields to another lane, and retained until the process actually exits. Waiting jobs are scanned for fitting smaller work; after eight bypasses of the oldest blocked job, new admissions drain until that oldest job fits. Thus large boards cannot be starved by an endless stream of small boards. Memory-aware dispatch can change the initial rotating variant order, and actual concurrency is lower during large-board runs. An exclusive sample may take several minutes with other CPU slots idle; this preserves the same360-second solver wall budget without risking three9GiB processes on a16GiB machine.

Use `--memory-reservations PATH`, `--reservation-budget-gib N` or `--max-memory-bypasses N` only as explicit recorded protocol changes. To regenerate estimates from the earlier profile and fresh matrix records:

```bash
python3 experiments/hd-research/harness/build_memory_reservations.py \
  --dataset18-profile /path/to/dataset18.json \
  --dataset24-profile /path/to/dataset24-profile.json \
  --results /tmp/hd-matrix-results \
  --out experiments/hd-research/harness/memory-reservations.json
```

Freeze this policy for a cohort; do not silently change it while measured jobs are running. `test_memory_scheduler.py` checks exclusive heavy jobs, bounded total reservations, scanning around blocked work, accounting for growth above an estimate, and completion of a simulated252-job matrix. These are admission tests, not solver performance runs.

On a runner with at least64GiB RAM, the same three-worker experiment can explicitly permit heavy-board overlap using the original unclamped margin estimates:

```bash
python3 experiments/hd-research/harness/run_matrix.py \
  --worktree-root /tmp/hd-experiments \
  --out /tmp/hd-matrix-results \
  --variants control,kernel --concurrency 3 --cpus 0,1,2 \
  --allow-heavy-overlap --reservation-budget-gib 48 --memory-guard-gib 48
```

This configuration reserves approximately14.5,16.25,19GiB for dataset24 samples001,004,024 rather than clamping each to the local13GiB budget. A task whose estimate exceeds the selected budget still runs alone. The driver rejects a budget that leaves less than2GiB outside reservations on the current physical/cgroup memory limit. It retains the same worker, effort, sample timeout and one routing thread per sample; only explicitly recorded admission resources change. Host-root VM cgroup control files that are absent are reported as null, with physical RAM and CPU affinity still recorded.

The full six-variant matrix is:

```bash
python3 experiments/hd-research/harness/run_matrix.py \
  --worktree-root /tmp/hd-experiments \
  --out /tmp/hd-matrix-results \
  --concurrency 3 --cpus 0,1,2
```

Each dataset/sample starts with a rotating variant order. Within a global pool, memory admission and completion order can differ from that initial order. The initial control-only pass and dataset18 cohort used only the current-RSS launch guard before the reservation policy was added. The initial control pass used two sample processes while implementations and focused checks were finishing; the dataset18 cohort used three. Later dataset24 runs use reservations and lower actual concurrency for heavy boards. Check each record's `measurementProvenance` and timestamped invocation metadata. A single pass is exploratory evidence; repeat promising paired boards at the same concurrency before making precise speed claims.

Completed records are resumable only with matching commit, mode, effort, timeout, and worker hash. Driver-only changes require a reviewed, explicitly recorded `--allow-runner-change`. The initial driver version stored provenance in invocation metadata; a resume imports that metadata into its records while preserving a timestamped copy. Dirty checkouts are rejected. Use a new output directory or `--rerun` for a changed implementation. Never run two orchestrators against the same output directory; an OS file lock enforces this.

Create `PAUSE_AFTER_CURRENT` in the output directory to stop launching samples and finish those in flight. Remove that file before resuming. Each child has its own process group; a wall timeout kills that process group. The parent preserves the latest synchronous phase/HD heartbeat and extends its partial active-stage timing to the timeout. The existing `solveAsync(undefined)` executes synchronously, so timer-only progress would otherwise misattribute long timeouts to the initial phase. All variants receive the same measurement hook.

Full results live at `full/<variant>/<dataset>-<sample>.json`, with `.task.json`, `.stdout.log`, and `.stderr.log` siblings. `events.jsonl` records starts, heartbeats, and completions. `metadata-*.json` preserves invocation versions and resources. `hd-inputs/*.json` contains deduplicated HD-stage inputs, identified by SHA-256. Serialization/write overhead is included identically for every variant and separately reported as `result.hdInput.captureMs`. The constructor input hash verifies whether variants truly received the same HD problem.

Replaying captured control HD inputs isolates HD behavior from upstream stages. This performs real routing, but does not certify a final DRC-clean board:

```bash
python3 experiments/hd-research/harness/run_matrix.py \
  --worktree-root /tmp/hd-experiments \
  --out /tmp/hd-replays \
  --mode hd --full-results /tmp/hd-matrix-results \
  --variants control,kernel --datasets srj18 --samples 2 \
  --concurrency 2 --cpus 0,1

python3 experiments/hd-research/harness/summarize.py /tmp/hd-replays --mode hd
```

Use `--hd-input /absolute/path/to/params.json` with one selected dataset/sample to replay an explicit previously captured input. `--node-ids cmn_3,cmn_36` restricts a replay to named nodes for diagnosis; it is a different workload from the complete HD stage. `--save-output` saves routed copper for independent geometry analysis and can create large files. A final board's relaxed DRC is not a substitute for intermediate full-clearance checking, and an intermediate conflict is not proof that downstream repair will fail.

The summary preserves completion, DRC, timeouts, other failures, vias, wire length, memory, phase times, and experiment counters. For full-pipeline aggregate scoring, any unsuccessful or DRC-unclean sample receives the configured timeout; early failure cannot look like a speedup. Success-only speed compares the same boards that both variants completed cleanly. HD timing is compared separately when both HD stages completed, even if a later stage failed. Identical upstream failures are identified separately and provide no evidence against an HD improvement. HD replays report elapsed time, completion, per-node hashes, and counters without claiming board DRC.

Protocol checks used an actual dataset18 sample003 complete run and a separate two-second timeout. The first completed with zero relaxed-DRC errors; the timeout preserved the active port-point phase and partial stage clocks. Those smoke outputs are not production performance estimates.

The experimental `hd-experiment-paired.yml` pull-request workflow runs all42 control samples followed by all42 experiment samples on one Blacksmith32vCPU ARM runner, using Bun1.4.3 and three affinity-pinned sample lanes. Each of the five experiment PRs gets an independent paired job. It installs one shared dependency tree after verifying dependency manifests match and uploads the generated lockfile, exact refs, protocol, all results, captured HD inputs, and summaries. A compressed summary is also emitted in the completed job log. Only benchmark work runs in that workflow; it sends no comments or notifications. Results from this ARM runner are compared within their own pair, separately from preliminary local x64 checks.
