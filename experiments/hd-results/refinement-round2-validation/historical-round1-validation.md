# Refined autorouter experiment validation

The local source checks and targeted numerical regressions pass as scoped below. This report does **not** claim all CI checks pass and contains no dataset performance conclusions. It consolidates existing outputs; it runs no further tests or benchmarks.

| PR | Published standalone source | Local source equivalent | Runtime used for targeted QA |
| --- | --- | --- | --- |
| [#3327](https://github.com/tscircuit/tscircuit-autorouter/pull/3327) | `c879c9d5f4689502a279ed9d92a0299946eafcfb` | `33e8eba837d672cb280faaf80f3fee7ed50de5a2` | `4549377e58aca4e27080e57b5f781f902d6689bc` |
| [#3328](https://github.com/tscircuit/tscircuit-autorouter/pull/3328) | `70d7a1bbbc61ca474c9b696cdccba7a8bd814c14` | `20da29a3e2a366d5aa7890e6e9a45fd0736e794a` | `cc68f9a05008d28b02f14870b6db71a4f12df2d3` |

## Portfolio: deterministic lazy setup

The final legacy-compatible suite passes **32 tests / 790 assertions**, independently counted from two archived logs (26/581 plus 6/209). Local TypeScript and build passed. The compiler emits no success text; its successful exit is recorded in the source metadata. The QA source differs from algorithm source `cfe6a3201271b3608d0097f8906b16d314e56909` only in experiment documentation; the published local source adds only the benchmark workflow reference/upload settings. Runtime, tests and scripts are identical across these local source scopes.

The focused suite checks exact legacy/eager/lazy routes, winners and work at requested widths of 0.1, 0.15 and 0.2 mm, rare seed 5/priority-family allocation, no-clock scheduling, eligibility, caches and native worker behavior. An A03 proposal reaches final 0.2 mm copper widths when a nominal 0.2 mm connection and 0.15 mm minimum are resolved. Routes lacking a resolved nominal width retain their pre-existing width behavior; this is not a universal width certificate.

The two-phase USB numerical regression passes all 9 assertions. Its temporary copy removes exactly two reviewed SVG-await statements and preserves input preparation, solves and every numerical assertion. The unchanged dataset18 sample01 test passes all 8 assertions **including SVG**, with 1,143 actual native-four-worker dispatches and 205 traces. Serial and threaded complete-output hashes both equal `f1404b10babf382867a0eb85cf5a8a3851130465cba7af4314c9f109d7a6561a`. Original tracked tests remain unchanged, temporary probes were removed, and the frozen QA worktree is clean.

Ordinary CI for head `c879c9d5f4689502a279ed9d92a0299946eafcfb` tested merge `3daaf0b7f715335f3b59f07b713a5a7d3ff6da1f` into base `9e751e3c7650a1f21f52bad9160650d6aa388a14`. **All nine Bun test shards pass**, as do Type Check and Build/packed-runtime consumers. The full unmodified A64 test passes both early SVG comparisons and every later numerical guard; original T113, MIDI, USB, native-worker parity and clock-skew regressions also pass. Format Check remains failing with 38 diagnostics, under the instruction not to format/lint. These current-base merge results are separate from the exact standalone benchmark comparison; historical failure-name differences across dependency/source contexts are not attributed solely to lazy setup. [Bun run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40744329951) · [Build run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40744329568) · [Type Check run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40744329995).

## Legalization: selective projection

Local TypeScript and build passed. The session records an initial 21-test/193-assertion focused run and an affected 3-test/26-assertion rerun after type fixes. Their raw local focused outputs were not archived, so these are explicitly recorded session counts; the overlapping rerun is **not** added as three distinct tests. Archived local build output and current CI Type Check/Build independently remain available.

The frozen runtime QA at `cc68f9a05008d28b02f14870b6db71a4f12df2d3` passes A64 (17 numerical assertions), two-phase USB (9), P4 circuit102 (19), and the complete native-four-worker sample01 test (8, including SVG). A64/USB supplemental copies omit exactly two SVG awaits per file. T113 completes with 388 traces, zero via-clearance errors and passes all preceding numerical guards, but its actual test **fails the final SVG assertion** (37.854% difference against 2% allowed locally). Its 17 expect calls include that failed SVG call. No later numerical guard is hidden by this final image failure.

The successor `2ca2f3e20f42e61c7b133013d5ac0d0731e1e7a8` changes only three focused tests: strict getter types, public constructor-option reads, and additional iteration-propagation assertions. Solver runtime is unchanged. Published local source `20da29a3e2a366d5aa7890e6e9a45fd0736e794a` adds the frozen benchmark harness/workflow only. No runtime equivalence to the old full-projection experiment is implied.

Ordinary CI for head `70d7a1bbbc61ca474c9b696cdccba7a8bd814c14` tested merge `150ba9e1a5d6fae03e5d17ec503a476f3825515b` into base `9e751e3c7650a1f21f52bad9160650d6aa388a14`, rather than exact standalone benchmark baseline `637b6c581128238f6c61227a1c15be423d24baca`. Type Check and Build/packed-runtime consumers pass. Broad Bun CI retains **seven unique SVG failures**, each also observed in historical full-projection CI (A64, T113, dataset18 sample3 at 2x effort, bug88, bug94, bug107 and bug109); no new observed numerical failure was found in those completed jobs. The A64 image failure masks later guards in ordinary CI, which are covered separately by the 17-assertion local numerical probe. Format Check fails (28 diagnostics); no formatting or snapshots were changed. Failure-name history across different merge/dependency contexts does not establish byte-identical behavior.

## Retained adverse evidence and limits

The earlier corrected candidate-pool lazy source `fbf95287d98e067e314eae1c47999664f3305fb6` remains **censored at 180 seconds** on USB. The separately bounded 360-second corrected-eager stage-observer diagnostic at `2708fcb418808ce519f2ec56087992b901152f30` passes 9 numerical assertions. It does not replace the censor, provide a matched timing comparison, or establish its cause. The final portfolio source restores legacy candidate eligibility and has separate frozen QA evidence.

These are fixture correctness checks. They do not establish every manufacturing rule, all dataset outcomes, or an overall speedup. Elapsed/RSS fields record resource bounds only. Full dataset18/24 results belong in a separately verified benchmark report. Exact source records, commands, hashes, omitted SVG statements, cleanup checks and remaining CI failures are retained in [historical-round1-validation.json](historical-round1-validation.json) and its `evidence/` files.


Publication note: this is a historical source-scoped report. The original full evidence-file inventory is retained in `historical-round1-file-manifest.json`; selected adverse result metadata are included under `historical-results/`. The other local evidence paths in the original JSON are provenance references and are not claimed to be bundled here. The sole prose adaptation changes the JSON hyperlink to its published filename.
