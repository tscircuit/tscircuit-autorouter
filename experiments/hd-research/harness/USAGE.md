This harness measures Pipeline 9 on datasets 18 and 24, effort 1, a 360-second full-sample wall limit, and a fresh Bun process per sample. It invokes the repository's existing `runTask`, including relaxed DRC and trace lint. It omits the SVG payload from saved results and adds wire length, output/trace hashes, HD counters, and captured HD-stage constructor inputs.

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

Choose CPUs from the current process's allowed affinity. CPU pinning is optional; omit `--cpus` on a machine without `taskset`. The managed experiment machine has a four-core CPU quota, allowed CPU IDs 0–4, and 16 GiB RAM. The harness allows at most three concurrent sample processes on this machine, with a 12 GiB launch guard based on active samples' current RSS. The guard is not a hard memory cap and cannot prevent a running process from growing. Other coding/test processes can still affect CPU and memory despite sample affinity.

The full six-variant matrix is:

```bash
python3 experiments/hd-research/harness/run_matrix.py \
  --worktree-root /tmp/hd-experiments \
  --out /tmp/hd-matrix-results \
  --concurrency 3 --cpus 0,1,2
```

Each dataset/sample gets a rotating variant order. Within a global pool, completion order can differ from dispatch order. The initial control-only pass in this research used two sample processes while implementations and focused checks were finishing; subsequent matrix runs may use three. Check each record's `measurementProvenance` and timestamped invocation metadata. A single pass is exploratory evidence; repeat promising paired boards at the same concurrency before making precise speed claims.

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
