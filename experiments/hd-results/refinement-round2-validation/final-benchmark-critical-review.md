Independent audit of final legalization confirmation `40772916886`

All 126 authenticated records were read directly, without importing the matrix
or report helpers. All six arm summaries and all six contrasts match the official
report's counts, timing cohorts, output hashes, iteration counts and quality
totals. Earlier jobs' timings were not pooled.

| Source | Dataset 18 clean | Dataset 24 clean | Total clean |
| --- | ---: | ---: | ---: |
| Baseline `637b6c58` | 16/16 | 17/26 | 33/42 |
| Previous full `8115e35a` | 16/16 | 19/26 | 35/42 |
| Final `365b3845` | 15/16 | 19/26 | 34/42 |

The final candidate retains dataset24 samples 2 and 11, but still loses dataset18
sample 15. That board completes in 238.300 seconds with **174 DRC errors**,
compared with clean baseline/previous-full completions in 139.520/201.103 seconds.
The previous published candidate's 178-error count is not this final result.

Compared with previous full, final common-clean routing changes by **-0.299%** on
dataset18 and **+0.185%** on dataset24. The dataset18 cohort excludes the lost
sample15. Strict same-constructor completed-HD changes are **-0.383%/+1.314%**.
These results demonstrate no substantial routing optimization. The fixed-corpus
comparison score is 5009.663 versus 4850.828 seconds, **3.274% worse** than previous
full; that score assigns 360 seconds to every non-clean outcome and is not runner
wall time.

All 37 completed-HD iteration counts agree. This does not prove exact work
parity: `priorityCompletedWorkUnits` differs on dataset18 samples13/16 and
dataset24 sample11, with known coverage34/37. Physical projection counters also
intentionally differ. Final output hashes match previous full on only 4/16 and
7/20 paired solved boards; unchanged geometry is not claimed.

On common-clean boards, final versus previous full uses 45 more vias on
dataset18 (15 boards), and four fewer on dataset24 (19 boards). Wire length
increases about 57.75mm on each dataset, with finite coverage12/15 and19/19.
These changes provide no broad geometry-quality dominance.

Global dataset24 process RSS maxima have different scopes: baseline8.763GiB is
sample24's edge timeout before HD; previous-full6.856GiB and final6.450GiB are
sample1 HD timeouts. Failure phase is not the measured phase of the RSS peak.
These unmatched full-process maxima do not establish an isolated HD memory gain.

The targeted MIDI numerical fix, shared-junction preservation and local dense-node
improvements remain useful evidence. They do not erase the lost benchmark board
or the separate final-source CI merge's **92-error Bug107 failure**. MIDI passes
its preceding numerical/preload guards and fails only its final3.077% SVG
comparison; seven SVG failures remain overall. Keep the final candidate a draft,
retain the previous full source as the strongest measured quality control, and do
not describe this refinement as a regression-free breakthrough.

This is one observation per board and arm on a shared runner. Clean means the
existing relaxed benchmark DRC; final geometry was not archived for a complete
independent manufacturing-rule audit. CI merge/base scopes and standalone
benchmark source identities remain separate.
