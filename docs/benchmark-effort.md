# Comparing effort

Comment `/benchmark-effort` on a PR to run pipeline 9 against all of dataset18
at 1x, 1.5x, and 2x on the same Blacksmith runner. The authorized PR-comment
dispatcher posts a comparison and retains all three JSON reports as an artifact.
The command takes no arguments. For a manual workflow dispatch, use Benchmark
Effort with the commit SHA and PR number.

Routing/search settings are capped at 1x; lower-effort settings are preserved.
Additional effort runs extra trace-simplification passes (2, 3, and 4), including
cleanup of mutated preloaded traces, with proportional iteration budgets.
Outer pipeline budgets still grow to accommodate the extra cleanup work.
Per-sample benchmark timeouts grow from 360s to 540s and 720s.

Via totals compare only samples solved with relaxed DRC passing at every effort.
Completion, DRC pass rates, timeouts, paired runtime, and individual via counts
are also reported. Lower via totals are an improvement only when completion and
DRC outcomes remain acceptable; a timeout must never count as a zero-via route.

On a Blacksmith runner, the comparison can also be invoked with
`bun scripts/benchmark/effort-comparison.ts`.
