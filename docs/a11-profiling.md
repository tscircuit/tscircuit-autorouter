# Profiling native A11 routing

Use the existing solver profiler with an explicit pipeline. For example:

```sh
bun scripts/profile-solvers.ts --pipeline 9 --dataset srj18 --effort 1 \
  --sample-timeout 360s \
  --solver-name HighDensitySolverA11 \
  --solver-name GrowShrinkHighDensityIntraNodeSolver
```

`--solver-name` filters measurements only. It does not change the portfolio or
which solvers run. Omit it to record every instrumented solver. Pipeline 7 remains
the default when `--pipeline` is omitted.

`profile-solvers.json` contains one record per solver instance, including
unfinished candidates. A11 records include accumulated step time, iterations,
progress, solved segment count, selection, and failure or rejection reason.
Rejections retain the existing geometry, native endpoint and board copper errors.
Captured native inputs can be replayed independently of portfolio scheduling.
Grow/shrink records include the solver's existing `growthAttempts` counter.

Times measure executed work, including package solver batches. They exclude time
spent waiting while other portfolio candidates run. Parent and child times
overlap: do not sum all solver rows to estimate total pipeline time. Use the
ordinary benchmark for end-to-end timing and completion/DRC comparisons.

Workers checkpoint records every 30 seconds. If a worker times out, its records
are the last checkpoint and therefore a lower bound on work before termination.
The report lists timed-out and failed scenarios separately. The displayed stage
percentages use only completed scenarios.

## Comparing older revisions

The comparison workflows use `scripts/profile/prepare-checkout.sh` to install the
same measurement hooks and controller in disposable checkouts. The accompanying
patch changes only step timing in `BaseSolver` and `HyperParameterSupervisorSolver`.
It preserves each revision's routing code and dependencies. Preparation verifies
the patch or its already-applied state and fails on incompatible source; it does
not run an uninstrumented comparison. Keep the patch synchronized with those two
hooks when changing instrumentation.
