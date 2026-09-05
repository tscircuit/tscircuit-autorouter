# Repair04 SRJ33 comparison

The corrected validation suite is `repair04-via-pad-v1`. Both baseline and
candidate explicitly enable `includeViaPadChecks: true` for default and relaxed
DRC. This adds the existing `checkViasInPads` and `checkViaPadClearance` checks,
using the same connectivity map and existing clearance thresholds. Same-net
via centers inside pads are errors unless the board explicitly permits them.

The historical V8 evidence omitted these checks. Its reported passes are not
clean results under this corrected suite. Preserve that evidence unchanged;
never relabel or mix its DRC counts with new results. To reuse its upstream
checkpoints, re-evaluate the unchanged final baseline outputs using the new
suite in a new baseline directory, retain the exact original output/checkpoint
bytes, and record the validation-suite marker in the new summary. Old stage
error arrays are historical diagnostics unless independently re-evaluated.
The disabled replay must still reproduce the original geometry exactly and
match the newly evaluated baseline DRC counts before a candidate can pass.

Run these commands from the repository root in the benchmark environment. Keep
the dependency lockfile, Bun version, architecture, effort, and evaluator the
same between the baseline and candidate. Use at most half the available CPU
cores for `--concurrency`.

The source dataset is the complete 37-board package pinned at
`f566b62be0f83395d9ab63ddc068f9d645b68b16`. The harness rejects changed membership.
An optional second report covers every board in the separately published
15-board revision `026a78cb005ab33dde24f2db8fefbfd8d8efa614`; the comparator
verifies its original input-file hashes against the source manifest. Keep both
reports when presenting results. The smaller published set is not a selection
based on repair04 outcomes.

## Full pipeline runs

```sh
bun scripts/benchmark/repair04-srj33.ts --mode baseline --out-dir /tmp/repair04-baseline --concurrency 2 --effort 1 --timeout-ms 1800000
bun scripts/benchmark/repair04-srj33.ts --mode candidate --out-dir /tmp/repair04-candidate --concurrency 2 --effort 1 --timeout-ms 1800000
bun scripts/benchmark/compare-repair04-srj33.ts /tmp/repair04-baseline/summary.json /tmp/repair04-candidate/summary.json /tmp/repair04-comparison.json
```

Baseline disables only `enableRepair04`. Both runs use the real Pipeline9,
including its existing downstream joint repair, length matching, and power
trace expansion. Every board remains in the denominator, including failures
and timeouts. Both runs independently evaluate final output with the existing
relaxed and default DRC evaluators with via-pad checks explicitly enabled.
Both sides must use the same validation-suite marker, thresholds, and conversion.

Each full run writes a checkpoint immediately after repair03, stage DRC
errors, final DRC errors, final routed output, input SHA-256, timing, and run
configuration. `--samples sample006,sample048` supports exploratory runs;
their summaries remain incomplete and cannot produce a complete comparison.

## Validated checkpoint replay

Repeated upstream routing can be avoided using the baseline checkpoints:

```sh
bun build scripts/benchmark/replay-repair04-checkpoint.ts --target bun --outfile /tmp/repair04-replay.js
bun scripts/benchmark/replay-repair04-srj33.ts /tmp/repair04-baseline /tmp/repair04-replay-candidate /tmp/repair04-replay.js 2
bun scripts/benchmark/compare-repair04-srj33.ts /tmp/repair04-baseline/summary.json /tmp/repair04-replay-candidate/summary.json /tmp/repair04-replay-comparison.json
```

The replay restores captured repair03 output and then executes the actual
remaining Pipeline9 stages. Before enabling repair04 for each board, it runs
the disabled pipeline and requires the same output structure and metadata,
coordinates within `1e-12`, and identical strict and relaxed error counts as
the full baseline. It records raw output equality and maximum numeric
difference separately. A failed identity gate excludes that candidate from
passing results and leaves the board in the denominator. Using the same Bun
version and architecture avoids cross-runtime floating-point differences
that can affect later routing choices.

The replay runner records the immutable bundle SHA-256 and rejects reusing
an output directory with a different bundle. It can resume completed cases
for that bundle. Resuming also requires the exact baseline summary and every
baseline checkpoint/output byte to match; older configurations without this
fingerprint require a fresh output directory. Keep the bundle and source
revision with the results.
Candidate replay timings exclude upstream routing and must not be compared
as a speed ratio with full baseline timings.

Disjoint batches can run on separate benchmark machines using the identical
frozen bundle, complete baseline, Bun version, architecture, and effort.
Pass each batch's comma-separated sample selection as the runner's final
argument. Merge their result directories after every board has a result:

```sh
bun scripts/benchmark/merge-repair04-replays.ts /tmp/repair04-complete /tmp/repair04-current15 /tmp/repair04-legacy22
```

The merger requires exactly one result for every source board and matching
runtime, bundle, and full-baseline fingerprints. It retains source summary
and configuration hashes so the combined report can be audited.

## Reporting the published 15-board revision

Download `manifest.json` from each immutable dataset revision, then pass both
files after the output path:

```sh
bun scripts/benchmark/compare-repair04-srj33.ts /tmp/repair04-baseline/summary.json /tmp/repair04-replay-candidate/summary.json /tmp/repair04-current15-comparison.json /tmp/srj33-current-manifest.json /tmp/srj33-pinned-manifest.json
```

The comparator requires complete 37-board source results for either report.
It reports newly passing boards, pass-to-fail regressions, error-count
regressions, solved counts, timeouts, and manifest provenance. With zero
baseline passes, a relative percentage increase is undefined. Report the
additional passing boards and percentage-point change explicitly; five
additional passes among all 15 published boards is a 33.33 percentage-point
increase.
