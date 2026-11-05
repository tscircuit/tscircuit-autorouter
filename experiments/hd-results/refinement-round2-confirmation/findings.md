# Second refinement confirmation: all168 records

Run [40760310372](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40760310372) completed successfully. All168 records, the four exact source refs, predeclared seed2026102812/config, frozen measurement files and dependency bytes authenticate against the downloaded GitHub artifact. The archive is complete, with no missing protocol files. A second local reconstruction matches the emitted summary. This is one observation per source/board on the same64GiB/six-lane job; confidence intervals and equal realized co-runner guarantees are unavailable.

## Portfolio: near-flat timing, no breakthrough demonstrated

Measured source `5b4c680c842eafe17e2830fc9a29d16d17d6a9b2` uses the shared temporary prototype and restores the native prototype before setup/search. Against the control in this job:

| Metric | Dataset18 | Dataset24 |
| --- | ---: | ---: |
| Clean boards, control → revised lazy | 16 → 16 | 17 → 17 |
| Common-clean whole routing | 1054.651 → 1061.634s (+0.662%) | 927.384 → 907.629s (−2.130%) |
| Strict completed HD | 351.550 → 358.132s (+1.872%) | 693.642 → 693.276s (−0.0528%) |
| Completed-HD cohort | 16 | 21 |
| Final output hashes equal / paired solved | 16/16 | 19/19 |
| HD iteration counts equal / strict completed | 16/16 | 20/21 |
| Maximum observed process RSS, control → revised lazy | 2.802 → 2.858GiB | 6.047 → 8.634GiB |

The new implementation is near the baseline in elapsed cost. It demonstrates neither a substantial HD speedup nor additional clean boards. The earlier implementation's15–16%HD slowdown remains a separate negative cohort, not a result to erase or pool into this job. This job does not include that earlier implementation or an eager arm, so the change between jobs is not a direct measured speedup of the source rewrite.

The deferral mechanism still avoids substantial setup work: matched completed-HD boards report25946 unmaterialized setups out of30708 possible upfront setups on dataset18, and35949/42647 on dataset24 (about84%). This mechanism count does not imply equivalent wall-time or RSS savings. The dataset24 maximum is6.047GiB for control on#4, which times out in initial HD, and8.634GiB for revised lazy on#24, which times out upstream in the edge solver before HD. These maxima cover different boards and phases. On matched#24, control uses4.748GiB and revised lazy8.634GiB, both before HD; that observed difference cannot be attributed to lazy HD code. All end-to-end RSS observations remain recorded.

Dataset24#21 has one extra HD iteration (49029 → 49030) and110 fewer priority completed-work units (2272373 → 2272263), while allocated-work units,196 completed candidates and5976 priority instances match. Its final output bytes still match exactly. Therefore all35 paired solved outputs match, but exact work parity across all37 completed-HD boards is not established. Timing on that board cannot be attributed solely to skipped setup.

The largest common-clean routing increase is dataset18#2,132.885 → 141.528s (+8.643s,+6.50%). Dataset24's three largest reductions are#21(−6.610s),#5(−5.162s) and#15(−4.733s); its largest increase is#8(+2.392s). These are single observations, not statistical tail guarantees. No clean board is gained or lost.

## Legalization: quality gain recovered, numerical regression blocks promotion

The old full source `8115e35a4517191c306820438b14a197dc911c7a` remains the quality leader in this job:16/16 clean on dataset18 and19/26 on dataset24, versus control16/17. Both dataset24#2 and#11 become clean, with no lost clean board. In this cohort, dataset24#11 changes from a timeout in `highDensityForceImproveSolver` to a clean solve; this is not a new initial-HD completion. A later-cleanup timeout occurred in an earlier refinement cohort and must not be substituted for this run's recorded phase.

The revised source `83a593a901b1209a024ab3a96bb9c191871b8df4` also produces19 clean dataset24 boards and recovers#11, which the first refined-full cohort had lost. However, it loses dataset18#15: that board solves with178 relaxed-DRC errors, compared with zero for both control and old-full. The178 consist of39 pad/trace-clearance,59 trace,7 via-clearance,38 via/trace-clearance,25 trace/pad accidental-contact and10 trace/via-overlap errors. This source therefore has34 clean boards in total, behind old-full's35, and is not a regression-free improvement.

| Metric | Dataset18 | Dataset24 |
| --- | ---: | ---: |
| Control / old-full / revised clean | 16 / 16 / 15 | 17 / 19 / 19 |
| Revised common-clean routing vs control | +1.312% (15 boards) | −2.715% (17 boards) |
| Revised strict completed-HD vs control | +6.385% (16 boards) | +4.353% (21 boards) |
| Revised common-clean routing vs old-full | +2.517% (15 boards) | −0.132% (19 boards) |
| Fixed-corpus score, control / old-full / revised | 1054.651 / 1109.513 / 1266.455s | 4167.384 / 3901.188 / 3899.368s |

The fixed-corpus score assigns360seconds to every unclean, failed or timed-out board; it is not runner wall time. Common-clean timing excludes changed clean outcomes and cannot replace the full score. The revised source is slower in initial HD; its recovered clean boards remain meaningful later-pipeline outcomes. Neither these gains nor their failures should be mislabeled as a large solver speedup.

The measured83a source also has two independently observed broader-CI numerical failures (MIDI via clearance and Bug107); they remain blockers even if this benchmark corpus improves. The subsequent local conservative metadata-anchor source `2f77750b872ddfeae0026987de3bf01e253f9992` is distinct and has not been measured in this dataset matrix. Its unchanged Bug107 correctness case also fails, with92DRC errors, so removing the proven shared-junction compression defect does not establish whole-board regression freedom. These benchmark outcomes must not be transferred to that local source. Likewise, the initial full source's independently found unsafe intermediate drill proposals do not invalidate its final benchmark clean record, because archived final geometry is unavailable and no final-board safety conclusion follows from those intermediate proposals.

## Interpretation and preserved limits

Keep portfolio as an experimental implementation with no demonstrated significant optimization. The narrow conservative legalization fix preserves a proven shared junction while retaining joint physical projection, but its known Bug107 failure still blocks promotion. Further refinement must resolve the specific numerical regressions and receive its own source-bound dataset18/24 confirmation; no later source should inherit the measured83a results or be presented as a validated final source.

All failures, changed outcomes, partial timeout clocks, source identities, DRC messages and RSS measurements are preserved in the full report archive. Completed-HD timings require original raw-constructor equality; no fields were normalized. Old and new jobs remain separate evidence. The two candidate changes were not combined into one pipeline, so savings cannot be added. “Clean” is the benchmark's relaxed DRC definition, not a certificate for every manufacturing rule.
