# Concrete-route witness compatibility: paired experiment results

Observed fixed-corpus score: 4,904.8 → 4,874.0 (-0.63%) s; clean boards 33/42 → 33/42.

Control `637b6c581128238f6c61227a1c15be423d24baca`; experiment `5dadf1e9a920abb9a3ef3c2f4fd59aa7d27d8d19`. All 84 fresh-process records are present: 16 dataset18 and 26 dataset24 samples per revision. Pipeline 9, effort 1, one routing thread/sample, Bun 1.4.3, 3 sample lanes and a 360-second timeout. Both passes use one resolved dependency tree on the same runner; control ran first. This is one exploratory pair, without repeat/randomization or a significance estimate.

Resource profile: **3-lane original**. This report describes only this run; 3-lane originals and 6-lane resource followups remain separate evidence and are not pooled.

| Corpus | Solved, control → experiment | Clean, control → experiment | Timeouts | Other failures | Fixed-corpus score, s | Score ratio, control/experiment |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| srj18 (16) | 16 → 16 | 16 → 16 | 0 → 0 | 0 → 0 | 904.9 → 884.3 (-2.27%) | 1.023× |
| srj24 (26) | 19 → 19 | 17 → 17 | 6 → 6 | 1 → 1 | 3,999.9 → 3,989.6 (-0.26%) | 1.003× |

The fixed-corpus score uses measured routing time for a solved, relaxed-DRC-clean board and assigns 360 seconds to every other outcome, including early failures and solved-but-unclean boards. Lower is better. It is a comparison score, not actual total wall time. Clean means the repository's relaxed benchmark DRC, rather than every manufacturing rule.

| Corpus | Common-clean boards | Routing time on common-clean boards, s | Routing ratio | Same-input completed HD pairs | Initial HD time, s | HD ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| srj18 | 16 | 904.9 → 884.3 (-2.27%) | 1.023× | 16 | 313.1 → 306.3 (-2.16%) | 1.022× |
| srj24 | 17 | 759.9 → 749.6 (-1.35%) | 1.014× | 21 | 588.8 → 581.6 (-1.21%) | 1.012× |
| Both | 33 | 1,664.8 → 1,634.0 (-1.85%) | 1.019× | 37 | 901.8 → 887.9 (-1.54%) | 1.016× |

New clean outcomes (0): none. Lost clean outcomes (0): none.

New HD completions with identical inputs (0): none. Lost HD completions with identical inputs (0): none. These count even when a later pipeline stage fails. Their incomplete counterpart's partial HD clock is censored; these pairs are excluded from completed-pair HD ratios, and no full-stage speedup is inferred from that partial clock.

Common-clean timing excludes changed clean outcomes, so it cannot replace the complete-corpus score. HD timing requires both initial HD stages to have completed and identical captured constructor-input hashes; later repair failures do not erase that evidence. Partial HD timings from timeouts are excluded. Ratios above 1 favor the experiment; all ratios use sums, not averages of per-board ratios.

| Corpus | Common-clean vias | Common-clean wire length, mm | Maximum process RSS across all attempts, GiB |
| --- | ---: | ---: | ---: |
| srj18 | 3,397 → 3,393 (-0.12%); n=16 | 30,294.3 → 30,299.9 (+0.02%); n=13 | 2.872 → 2.449 (-14.75%) |
| srj24 | 2,740 → 2,745 (+0.18%); n=17 | 30,431.1 → 30,427.5 (-0.01%); n=17 | 8.923 → 8.916 (-0.07%) |

Via and length tradeoffs use common-clean boards with both quality values present; each cell gives that sample count. Peak RSS is the largest individual sample process, rather than aggregate runner memory; its maximum can come from different boards or failure states. An unchanged pre-HD failure can dominate that maximum, so it does not isolate solver memory. Per-sample memory is retained in the CSV. Missing quality values stay blank and are not inferred from provisional HD output.

**Metric-coverage limitation, srj18 wire length (mm):** 13/16 common-clean pairs have finite values on both revisions. Missing control: srj18-003, srj18-008, srj18-009; missing experiment: srj18-003, srj18-008, srj18-009. Metric coverage is separate from the complete 84-record benchmark execution.

| Corpus | Identical captured HD inputs | Identical upstream failure signature | Same upstream failure phase |
| --- | ---: | ---: | ---: |
| srj18 | 16/16 | 0 | 0 |
| srj24 | 24/26 | 2 | 2 |

Upstream counts are the harness's failures before either HD input was captured: exact signature also requires equal error text and timeout status. These are reported separately from HD algorithm evidence. A changed upstream input or a later-stage failure limits causal attribution; a useful same-input HD improvement can still be measured.

| Aggregated HD diagnostic | Dataset18, control → experiment | Dataset24, control → experiment |
| --- | ---: | ---: |
| `witnessCatalogDuplicatePaths` | 0 → 1,583 | 0 → 3,486 |
| `witnessCatalogEvictions` | 0 → 972 | 0 → 1,178 |
| `witnessCatalogInstances` | 0 → 6,196 | 0 → 9,955 |
| `witnessCatalogPaths` | 0 → 4,526 | 0 → 7,788 |
| `witnessCatalogStoredVertices` | 0 → 173,918 | 0 → 279,234 |
| `witnessCompatibilityAcceptedAssignments` | 0 → 6 | 0 → 16 |
| `witnessCompatibilityAssignments` | 0 → 15 | 0 → 33 |
| `witnessCompatibilityBoardObstaclesChecked` | 0 → 83 | 0 → 199 |
| `witnessCompatibilityBoardValidationIssues` | 0 → 41 | 0 → 43 |
| `witnessCompatibilityBoardValidationMicroseconds` | 0 → 170,324 | 0 → 468,700 |
| `witnessCompatibilityBoardValidations` | 0 → 15 | 0 → 33 |
| `witnessCompatibilityCrossContextAssignments` | 0 → 6 | 0 → 16 |
| `witnessCompatibilityLearnedPairExclusions` | 0 → 5,808 | 0 → 9,422 |
| `witnessCompatibilityPairCacheHits` | 0 → 360,939 | 0 → 538,316 |
| `witnessCompatibilityPairEvaluations` | 0 → 21,342 | 0 → 29,706 |
| `witnessCompatibilityPairQueries` | 0 → 382,349 | 0 → 568,106 |
| `witnessCompatibilityPoolExhaustions` | 0 → 3,042 | 0 → 4,783 |
| `witnessCompatibilityRejectedAssignments` | 0 → 9 | 0 → 17 |
| `witnessCompatibilitySelectionCaps` | 0 → 20 | 0 → 26 |
| `witnessCompatibilitySelectionMicroseconds` | 0 → 1,230,331 | 0 → 1,605,511 |
| `witnessCompatibilitySelectionVisits` | 0 → 347,074 | 0 → 502,271 |
| `witnessCompatibilitySelections` | 0 → 3,138 | 0 → 4,912 |
| `witnessCompatibilitySkippedVirtualCandidates` | 0 → 1,136 | 0 → 6,472 |

These counters aggregate the observed initial-HD attempt paths, including failed or timed-out boards; coverage depends on how far each run progressed. Uninstrumented control counters are shown as 0, meaning no recorded experimental event. Counter reductions alone do not establish faster or cleaner routing. Full numeric totals and per-sample values are retained beside this report.

Source: [paired benchmark run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40634279767), attempt 1. Finished 2026-10-28T05:42:52.569059+00:00. Decoded input SHA-256: `87d499ee8fe131a980edd4269f0fa09da7cce314fc863ae162345af56d92a842`.

Artifacts: [42 paired samples](per-sample.csv) and [numeric diagnostics](diagnostics.json).
