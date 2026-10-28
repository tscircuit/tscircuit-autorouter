# Sparse corridor search: paired experiment results

Observed fixed-corpus score: 4,893.9 → 10,061.9 (+105.60%) s; clean boards 33/42 → 16/42.

Control `637b6c581128238f6c61227a1c15be423d24baca`; experiment `ccb8c46bb767052c3bbefc77d4ebba89c7fc6bb0`. All 84 fresh-process records are present: 16 dataset18 and 26 dataset24 samples per revision. Pipeline 9, effort 1, one routing thread/sample, Bun 1.4.3, 3 sample lanes and a 360-second timeout. Both passes use one resolved dependency tree on the same runner; control ran first. This is one exploratory pair, without repeat/randomization or a significance estimate.

Resource profile: **3-lane original**. This report describes only this run; 3-lane originals and 6-lane resource followups remain separate evidence and are not pooled.

| Corpus | Solved, control → experiment | Clean, control → experiment | Timeouts | Other failures | Fixed-corpus score, s | Score ratio, control/experiment |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| srj18 (16) | 16 → 10 | 16 → 7 | 0 → 0 | 0 → 6 | 891.4 → 3,584.6 (+302.12%) | 0.249× |
| srj24 (26) | 19 → 15 | 17 → 9 | 6 → 6 | 1 → 5 | 4,002.4 → 6,477.3 (+61.83%) | 0.618× |

The fixed-corpus score uses measured routing time for a solved, relaxed-DRC-clean board and assigns 360 seconds to every other outcome, including early failures and solved-but-unclean boards. Lower is better. It is a comparison score, not actual total wall time. Clean means the repository's relaxed benchmark DRC, rather than every manufacturing rule.

| Corpus | Common-clean boards | Routing time on common-clean boards, s | Routing ratio | Same-input completed HD pairs | Initial HD time, s | HD ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| srj18 | 7 | 318.2 → 344.6 (+8.28%) | 0.924× | 16 | 310.9 → 343.9 (+10.59%) | 0.904× |
| srj24 | 8 | 195.3 → 215.0 (+10.07%) | 0.909× | 21 | 588.2 → 634.5 (+7.87%) | 0.927× |
| Both | 15 | 513.5 → 559.6 (+8.96%) | 0.918× | 37 | 899.1 → 978.4 (+8.81%) | 0.919× |

New clean outcomes (1): srj24-002. Lost clean outcomes (18): srj18-004, srj18-006, srj18-008, srj18-009, srj18-010, srj18-011, srj18-014, srj18-015, srj18-016, srj24-006, srj24-007, srj24-008, srj24-012, srj24-019, srj24-020, srj24-021, srj24-022, srj24-025.

New HD completions with identical inputs (0): none. Lost HD completions with identical inputs (0): none. These count even when a later pipeline stage fails. Their incomplete counterpart's partial HD clock is censored; these pairs are excluded from completed-pair HD ratios, and no full-stage speedup is inferred from that partial clock.

Common-clean timing excludes changed clean outcomes, so it cannot replace the complete-corpus score. HD timing requires both initial HD stages to have completed and identical captured constructor-input hashes; later repair failures do not erase that evidence. Partial HD timings from timeouts are excluded. Ratios above 1 favor the experiment; all ratios use sums, not averages of per-board ratios.

| Corpus | Common-clean vias | Common-clean wire length, mm | Maximum process RSS across all attempts, GiB |
| --- | ---: | ---: | ---: |
| srj18 | 1,557 → 1,559 (+0.13%); n=7 | 18,666.4 → 19,305.5 (+3.42%); n=6 | 2.499 → 2.290 (-8.39%) |
| srj24 | 965 → 965 (+0.00%); n=8 | 12,527.4 → 13,084.3 (+4.45%); n=8 | 7.210 → 8.716 (+20.89%) |

Via and length tradeoffs use common-clean boards with both quality values present; each cell gives that sample count. Peak RSS is the largest individual sample process, rather than aggregate runner memory; its maximum can come from different boards or failure states. An unchanged pre-HD failure can dominate that maximum, so it does not isolate solver memory. Per-sample memory is retained in the CSV. Missing quality values stay blank and are not inferred from provisional HD output.

**Metric-coverage limitation, srj18 wire length (mm):** 6/7 common-clean pairs have finite values on both revisions. Missing control: srj18-003; missing experiment: srj18-003. Metric coverage is separate from the complete 84-record benchmark execution.

| Corpus | Identical captured HD inputs | Identical upstream failure signature | Same upstream failure phase |
| --- | ---: | ---: | ---: |
| srj18 | 16/16 | 0 | 0 |
| srj24 | 24/26 | 2 | 2 |

Upstream counts are the harness's failures before either HD input was captured: exact signature also requires equal error text and timeout status. These are reported separately from HD algorithm evidence. A changed upstream input or a later-stage failure limits causal attribution; a useful same-input HD improvement can still be measured.

| Aggregated HD diagnostic | Dataset18, control → experiment | Dataset24, control → experiment |
| --- | ---: | ---: |
| `sparseBoardValidationCalls` | 0 → 5,187 | 0 → 8,087 |
| `sparseBoardValidationIssues` | 0 → 90 | 0 → 202 |
| `sparseBroadphaseTests` | 0 → 44,320,742 | 0 → 57,883,950 |
| `sparseEdgesChecked` | 0 → 5,241,621 | 0 → 8,544,611 |
| `sparseEvents` | 0 → 163,181 | 0 → 231,816 |
| `sparseExpandedStates` | 0 → 284,709 | 0 → 542,418 |
| `sparseGeometryTests` | 0 → 7,653,896 | 0 → 11,516,163 |
| `sparseInstances` | 0 → 14,818 | 0 → 26,912 |
| `sparseOrdersAttempted` | 0 → 7,514 | 0 → 11,920 |
| `sparseRefinements` | 0 → 10,865 | 0 → 16,875 |
| `sparseSearchTimeMs` | 0.000 → 37,213.135 | 0.000 → 69,898.371 |
| `sparseSolvedTasks` | 0 → 17,904 | 0 → 27,391 |
| `sparseUnknown` | 0 → 9,623 | 0 → 18,817 |
| `sparseWins` | 0 → 5,149 | 0 → 8,053 |

These counters aggregate the observed initial-HD attempt paths, including failed or timed-out boards; coverage depends on how far each run progressed. Uninstrumented control counters are shown as 0, meaning no recorded experimental event. Counter reductions alone do not establish faster or cleaner routing. Full numeric totals and per-sample values are retained beside this report.

Source: [paired benchmark run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40634273127), attempt 1. Finished 2026-10-28T05:42:22.435971+00:00. Decoded input SHA-256: `a47470e260e9bcf2bd4045e4198fd2c1446fa8caa15a6c85a91204123838d02b`.

Artifacts: [42 paired samples](per-sample.csv) and [numeric diagnostics](diagnostics.json).
