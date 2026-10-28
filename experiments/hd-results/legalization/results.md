# Physical legalization of grown routes: paired experiment results

Observed fixed-corpus score: 4,899.4 → 4,581.5 (-6.49%) s; clean boards 33/42 → 35/42.

Control `637b6c581128238f6c61227a1c15be423d24baca`; experiment `8115e35a4517191c306820438b14a197dc911c7a`. All 84 fresh-process records are present: 16 dataset18 and 26 dataset24 samples per revision. Pipeline 9, effort 1, one routing thread/sample, Bun 1.4.3, 3 sample lanes and a 360-second timeout. Both passes use one resolved dependency tree on the same runner; control ran first. This is one exploratory pair, without repeat/randomization or a significance estimate.

Resource profile: **3-lane original**. This report describes only this run; 3-lane originals and 6-lane resource followups remain separate evidence and are not pooled.

| Corpus | Solved, control → experiment | Clean, control → experiment | Timeouts | Other failures | Fixed-corpus score, s | Score ratio, control/experiment |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| srj18 (16) | 16 → 16 | 16 → 16 | 0 → 0 | 0 → 0 | 877.9 → 923.6 (+5.21%) | 0.950× |
| srj24 (26) | 19 → 20 | 17 → 19 | 6 → 5 | 1 → 1 | 4,021.6 → 3,657.9 (-9.04%) | 1.099× |

The fixed-corpus score uses measured routing time for a solved, relaxed-DRC-clean board and assigns 360 seconds to every other outcome, including early failures and solved-but-unclean boards. Lower is better. It is a comparison score, not actual total wall time. Clean means the repository's relaxed benchmark DRC, rather than every manufacturing rule.

| Corpus | Common-clean boards | Routing time on common-clean boards, s | Routing ratio | Same-input completed HD pairs | Initial HD time, s | HD ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| srj18 | 16 | 877.9 → 923.6 (+5.21%) | 0.950× | 16 | 304.2 → 323.4 (+6.31%) | 0.941× |
| srj24 | 17 | 781.6 → 726.2 (-7.09%) | 1.076× | 21 | 591.6 → 607.4 (+2.67%) | 0.974× |
| Both | 33 | 1,659.4 → 1,649.8 (-0.58%) | 1.006× | 37 | 895.8 → 930.8 (+3.90%) | 0.962× |

New clean outcomes (2): srj24-002, srj24-011. Lost clean outcomes (0): none.

New HD completions with identical inputs (0): none. Lost HD completions with identical inputs (0): none. These count even when a later pipeline stage fails. Their incomplete counterpart's partial HD clock is censored; these pairs are excluded from completed-pair HD ratios, and no full-stage speedup is inferred from that partial clock.

Common-clean timing excludes changed clean outcomes, so it cannot replace the complete-corpus score. HD timing requires both initial HD stages to have completed and identical captured constructor-input hashes; later repair failures do not erase that evidence. Partial HD timings from timeouts are excluded. Ratios above 1 favor the experiment; all ratios use sums, not averages of per-board ratios.

| Corpus | Common-clean vias | Common-clean wire length, mm | Maximum process RSS across all attempts, GiB |
| --- | ---: | ---: | ---: |
| srj18 | 3,397 → 3,413 (+0.47%); n=16 | 30,294.3 → 30,310.6 (+0.05%); n=13 | 2.556 → 4.561 (+78.46%) |
| srj24 | 2,740 → 2,741 (+0.04%); n=17 | 30,431.1 → 30,455.3 (+0.08%); n=17 | 8.128 → 8.454 (+4.00%) |

Via and length tradeoffs use common-clean boards with both quality values present; each cell gives that sample count. Peak RSS is the largest individual sample process, rather than aggregate runner memory; its maximum can come from different boards or failure states. An unchanged pre-HD failure can dominate that maximum, so it does not isolate solver memory. Per-sample memory is retained in the CSV. Missing quality values stay blank and are not inferred from provisional HD output.

**Metric-coverage limitation, srj18 wire length (mm):** 13/16 common-clean pairs have finite values on both revisions. Missing control: srj18-003, srj18-008, srj18-009; missing experiment: srj18-003, srj18-008, srj18-009. Metric coverage is separate from the complete 84-record benchmark execution.

| Corpus | Identical captured HD inputs | Identical upstream failure signature | Same upstream failure phase |
| --- | ---: | ---: | ---: |
| srj18 | 16/16 | 0 | 0 |
| srj24 | 24/26 | 2 | 2 |

Upstream counts are the harness's failures before either HD input was captured: exact signature also requires equal error text and timeout status. These are reported separately from HD algorithm evidence. A changed upstream input or a later-stage failure limits causal attribution; a useful same-input HD improvement can still be measured.

| Aggregated HD diagnostic | Dataset18, control → experiment | Dataset24, control → experiment |
| --- | ---: | ---: |
| `physicalLegalizationBoardGuardRejectedCount` | 0 → 0 | 0 → 0 |
| `physicalLegalizationCandidateCopperPairs` | 0 → 1,115 | 0 → 5,504 |
| `physicalLegalizationCandidateOverlapPairs` | 0 → 260 | 0 → 2,607 |
| `physicalLegalizationCleanProposalCount` | 0 → 0 | 0 → 3 |
| `physicalLegalizationCopperPairsAfter` | 0 → 1,115 | 0 → 5,494 |
| `physicalLegalizationCopperPairsBefore` | 0 → 1,140 | 0 → 5,586 |
| `physicalLegalizationImprovedProposalCount` | 0 → 79 | 0 → 217 |
| `physicalLegalizationIndependentCleanCheckPassedCount` | 0 → 0 | 0 → 3 |
| `physicalLegalizationIterations` | 0 → 2,640 | 0 → 6,663 |
| `physicalLegalizationLossAfter` | 0.000 → 90.999 | 0.000 → 3,274.247 |
| `physicalLegalizationLossBefore` | 0.000 → 211.998 | 0.000 → 4,043.815 |
| `physicalLegalizationNotNeededProposalCount` | 0 → 3 | 0 → 9 |
| `physicalLegalizationObstacleGuardRejectedCount` | 0 → 0 | 0 → 0 |
| `physicalLegalizationOverlapPairsAfter` | 0 → 257 | 0 → 2,576 |
| `physicalLegalizationOverlapPairsBefore` | 0 → 479 | 0 → 3,256 |
| `physicalLegalizationPointsAfter` | 0 → 12,820 | 0 → 52,501 |
| `physicalLegalizationPointsBefore` | 0 → 37,244 | 0 → 157,322 |
| `physicalLegalizationProposalCount` | 0 → 130 | 0 → 582 |
| `physicalLegalizationTimeMs` | 0.000 → 7,415.276 | 0.000 → 23,887.322 |
| `physicalLegalizationUnchangedProposalCount` | 0 → 48 | 0 → 353 |
| `physicalLegalizationUnsupportedProposalCount` | 0 → 0 | 0 → 0 |

These counters aggregate the observed initial-HD attempt paths, including failed or timed-out boards; coverage depends on how far each run progressed. Uninstrumented control counters are shown as 0, meaning no recorded experimental event. Counter reductions alone do not establish faster or cleaner routing. Full numeric totals and per-sample values are retained beside this report.

Legalization copper/overlap counts describe conflicting route pairs in intermediate node proposals. They are not independent final-board DRC-error counts; final clean-board outcomes are reported above.

Source: [paired benchmark run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40634271235), attempt 1. Finished 2026-10-28T05:41:12.328887+00:00. Decoded input SHA-256: `127d7ba011da5a6b38920c7aa5a4e6852ee1a6d1c6de1c61d61ed03f7628c087`.

Artifacts: [42 paired samples](per-sample.csv) and [numeric diagnostics](diagnostics.json).
