# Same-machine comparisons

Comment `/benchmark-all --same-machine` on a PR to compare dataset01 and SRJ18.
Both revisions run sequentially on the same Blacksmith machine. The PR's
benchmark harness loads each checkout's solver and its dependencies separately.
Both outputs use the PR's DRC converter, rules, checks dependency, and dataset.
Solver timing ends before DRC, output export, and snapshot rendering.

The report records the solver and checker commits. Comparison fails if checker
revisions differ, solver revisions do not match the requested refs, the case
sets differ, or a solved case has no DRC result. Alongside pass/fail changes,
it lists per-board DRC count changes even when both revisions fail that board.

The workflow supplies these variables to the common harness:

- `BENCHMARK_SOLVER_ROOT`: checkout containing the solver's `lib/index.ts`.
- `BENCHMARK_SOLVER_REVISION`: commit of that checkout.
- `BENCHMARK_DRC_REVISION`: commit of the common harness and checker.
- `BENCHMARK_ROUTED_OUTPUT_DIR`: directory for solved-board JSON inputs.

The artifact includes `main/routed-outputs` and `pr/routed-outputs`, keyed by
solver and sample number. Each JSON file contains `inputSrj`,
`srjWithPointPairs`, and `routedTraces`, ready to pass to `evaluateRelaxedDrc`
or `getBugReportSnapshotSvg` for investigation without rerouting.

Standalone benchmark runs use the current checkout unless a solver root is
provided. Old reports without checker provenance cannot be used for this
normalized comparison; rerun them with the common harness.
