# Comparing effort

Comment `/benchmark-effort` on a PR to run pipeline 9 against all of dataset18
at 1x, 1.5x, and 2x on the same Blacksmith runner. The authorized PR-comment
dispatcher posts a comparison and retains all three JSON reports as an artifact.
The command takes no arguments. For a manual workflow dispatch, use Benchmark
Effort with the commit SHA and PR number.

Routing/search settings are capped at 1x; lower-effort settings are preserved.
Pipeline 9 first completes the same routing, simplification, and DRC repair at
all three effort levels. Extra effort then runs one or two additional cleanup
passes before length matching and power-trace expansion. Each pass is a candidate:
accept it only if it passes DRC (including board and declared clearances) and has
fewer vias, or equal vias with fewer route points. Retain the best accepted result
across passes. Other pipelines retain their 1x cleanup behavior above 1x effort.
Cleanup iteration budgets and outer pipeline budgets grow with the extra work.
The benchmark parser preserves fractional efforts and verifies the effective
effort in every generated report.
Per-sample benchmark timeouts grow from 600s to 900s and 1200s.

Via totals compare only samples solved with relaxed DRC passing at every effort.
Completion, DRC pass rates, timeouts, paired runtime, and individual via counts
are also reported. Lower via totals are an improvement only when completion and
DRC outcomes remain acceptable; a timeout must never count as a zero-via route.

On a Blacksmith runner, the comparison can also be invoked with
`bun scripts/benchmark/effort-comparison.ts`.
