# Final legalization refinement: useful fixes, no breakthrough

The final source `365b38451f01c734d3f60628dbd6db14760ca4e6` does not improve on the previous full legalizer. It retains the two extra dataset24 clean boards relative to baseline, but still loses dataset18 sample15. The previous full source `8115e35a4517191c306820438b14a197dc911c7a` remains the quality leader in this controlled comparison.

All 126 fresh-process records from [run40772916886](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40772916886) are fully authenticated. The complete archive, all 30 frozen measurement files, exact three source refs, independently approved configuration, dependency lock, queue/order/resource records and raw fingerprints pass verification. An independent reconstruction matches the archived summary. Pipeline9, effort1, one routing thread, Bun1.4.3, the 360-second routing limit, six pinned lanes and the recorded64-GiB admission profile are unchanged. This is one observation per board and arm; earlier VM timings are not pooled.

## Quality determines the result

| Source | Dataset18 clean | Dataset24 clean | Combined clean |
| --- | ---: | ---: | ---: |
| Baseline `637b6c58` | 16/16 | 17/26 | 33/42 |
| Previous full `8115e35a` | 16/16 | 19/26 | 35/42 |
| Final full `365b3845` | 15/16 | 19/26 | 34/42 |

Both full legalizers add dataset24 samples2 and11 without losing a baseline-clean dataset24 board. Sample2 changes from30 DRC errors to zero. Baseline sample11 times out in `highDensityForceImproveSolver`, after initial HD has completed; final sample11 is clean at281.274 seconds, and previous full is clean at281.971 seconds. These are downstream completion gains, not new initial-HD completions.

Final dataset18 sample15 is solved but has **174 DRC errors**, compared with zero under both controls. Its routing time is238.300 seconds, versus139.520 for baseline and201.103 for previous full. The174 errors are59 trace errors,39 pad/trace clearances,28 via/trace clearances,25 accidental pad contacts,15 trace/via overlaps and eight via/via clearances. This differs from the earlier source83a cohort's178 errors; counts and timings must stay attributed to their measured source and job. Restoring conservative owner-metadata anchors fixed the demonstrated branch-weld defect but did not restore this board.

Dataset24 sample14 remains solved with two accidental pad contacts in every arm. Baseline has six dataset24 timeouts, versus five in both full arms; each arm also retains one other dataset24 failure. No timed-out or unmeasured DRC result is treated as clean.

## Timing is near-flat relative to previous full

| Previous full → final full | Dataset18 | Dataset24 |
| --- | ---: | ---: |
| Routing on common clean boards | 827.090→824.619s; −0.299%, n15 | 1302.635→1305.044s; +0.185%, n19 |
| Strict same-constructor completed HD | 345.463→344.139s; −0.383%, n16 | 676.259→685.145s; +1.314%, n21 |

The paired routing medians are+0.053% on dataset18 and−0.572% on dataset24. There is no substantial optimization here. Final versus baseline common-clean routing is about3.46% faster on dataset18 and3.36% faster on dataset24, but the dataset18 timing excludes the lost clean board. It cannot offset that regression. The fixed-corpus score, which charges360 seconds to each non-clean outcome, is1184.619 versus1028.193 seconds for final versus previous full on dataset18; dataset24 is3825.044 versus3822.635 seconds. This score is not runner wall time.

All37 strict paired completed-HD iteration counts match. This is not exact work parity: `priorityCompletedWorkUnits` differs on dataset18 samples13 and16 and dataset24 sample11, with known coverage34/37. There are no new or lost initial-HD completions. The same loaded-SRJ and strict raw-constructor cohorts coincide in this job; no constructor fields or hashes were normalized. Censored partial-HD clocks remain excluded from these completed-phase timing cohorts. Final pipeline iteration counts remain unavailable.

Quality also changes within the common clean cohorts. Previous full→final has3104→3149 vias and28099.5→28157.2mm finite wire on dataset18(n15 vias, n12 wire), and3529→3525 vias with38947.1→39004.8mm wire on dataset24(n19). Final outputs match only4/16 paired solved dataset18 hashes and7/20 dataset24 hashes. Neither routing time nor equal initial-HD iteration counts establishes geometry parity.

## Memory observations have explicit scope

Dataset18 peak process RSS is2.857GiB baseline,4.656GiB previous full and3.386GiB final, each on sample15; the final arm fails DRC on that board. Dataset24 maxima are8.763GiB baseline on sample24's **edge-phase timeout**,6.856GiB previous full on sample1's **HD timeout**, and6.450GiB final on sample1's **HD timeout**. These maxima include differing outcomes and phases and are not isolated legalization-memory measurements. The raw/per-board supplemental records retain every RSS value and failure phase; no solver-memory saving is inferred from unmatched maxima.

## Preserve the valid fixes and the remaining blocker

The joint pad/drill projection and conservative junction anchors retain useful node-level evidence: captured cmn_3 reduces121 overlaps to18 and eight drill pairs to zero while preserving all504 original same-net port connections and passing3230 independent via-pair checks. Those local gains are not final-board certificates. The earlier old-full intermediate drill-pair violations likewise do not establish that its final clean benchmark boards are unsafe; archived final geometry is unavailable for that separate claim.

The final candidate also reuses the existing reported-via merger at the final joint state. The actual MIDI input's21 preloaded traces deliberately skip the bounded-regional path where that merger normally runs. The guarded final child repairs the remaining eligible same-net residual without moving immutable preloaded copper. Exact standalone source372baa96 passes all five original MIDI numerical/preload assertions with reference DRC zero, then fails only its final SVG comparison at3.077% versus1%. Ordinary CI for source365, on merge9d6c1452 into base9e751e3c, confirms that numerical-to-SVG improvement and passes all12 new/existing focused tests, native four-worker parity and the branch-junction regression.

Ordinary CI still reports **92 numerical DRC errors on Bug107**, plus seven SVG failures. Typecheck, build/packed consumers and other ordinary checks pass; Format Check retains38 diagnostics under the instruction not to format/lint. These CI merge checks, standalone local QA and the exact-source126-board-arm matrix are separate evidence scopes. The final source is not a regression-free promotion candidate.

The read-only Bug107 studies preserve falsified explanations: obstacle-filter expansion changed none of47 captured proposal outputs; actual near-coincident via aliases were absent; freezing boundary geometry worsened aggregate initial-HD geometry. Initial-HD body substitutions favored original old-full1164 physical errors over final-conservative1202 and strict-joint1392 on the same pre-stitch inputs. These are counterfactuals with continuity disabled, not historical full-pipeline replays. A separate unchanged-centerline width analysis clears only one of63 actual via/trace pairs by narrowing widths; it does not explain the broad92-error failure. See the [source-scoped validation and causal evidence](../refinement-round2-validation/VALIDATION.md).

The [earlier210-attempt ablations](../refinement-round1-legalization/results.md) and [168-attempt confirmation](../refinement-round2-confirmation/results.md) remain preserved. The refinement fixed specific correctness defects and recovered the lost dataset24 opportunity, but it neither exceeds previous full's clean count nor delivers a meaningful speedup. Keep this draft experimental and use the previous full source as the comparison leader, rather than promoting the final refinement.
