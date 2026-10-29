# Compact A01 frontier: paired experiment results

Observed fixed-corpus score: 4,916.9 → 4,878.4 (-0.78%) s; clean boards 33/42 → 34/42.

Control `637b6c581128238f6c61227a1c15be423d24baca`; experiment `dde0df8db1a5bf30ec080d61de71309e2ceffd32`. All 84 fresh-process records are present: 16 dataset18 and 26 dataset24 samples per revision. Pipeline 9, effort 1, one routing thread/sample, Bun 1.4.3, 3 sample lanes and a 360-second timeout. Both passes use one resolved dependency tree on the same runner; control ran first. This is one exploratory pair, without repeat/randomization or a significance estimate.

Resource profile: **3-lane original**. This report describes only this run; 3-lane originals and 6-lane resource followups remain separate evidence and are not pooled.

| Corpus | Solved, control → experiment | Clean, control → experiment | Timeouts | Other failures | Fixed-corpus score, s | Score ratio, control/experiment |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| srj18 (16) | 16 → 16 | 16 → 16 | 0 → 0 | 0 → 0 | 897.9 → 1,054.5 (+17.45%) | 0.851× |
| srj24 (26) | 19 → 19 | 17 → 18 | 6 → 6 | 1 → 1 | 4,019.0 → 3,824.0 (-4.85%) | 1.051× |

The fixed-corpus score uses measured routing time for a solved, relaxed-DRC-clean board and assigns 360 seconds to every other outcome, including early failures and solved-but-unclean boards. Lower is better. It is a comparison score, not actual total wall time. Clean means the repository's relaxed benchmark DRC, rather than every manufacturing rule.

| Corpus | Common-clean boards | Routing time on common-clean boards, s | Routing ratio | Same-input completed HD pairs | Initial HD time, s | HD ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| srj18 | 16 | 897.9 → 1,054.5 (+17.45%) | 0.851× | 16 | 310.4 → 359.8 (+15.94%) | 0.863× |
| srj24 | 17 | 779.0 → 757.7 (-2.73%) | 1.028× | 21 | 601.3 → 611.9 (+1.77%) | 0.983× |
| Both | 33 | 1,676.9 → 1,812.2 (+8.07%) | 0.925× | 37 | 911.7 → 971.8 (+6.59%) | 0.938× |

New clean outcomes (1): srj24-002. Lost clean outcomes (0): none.

New HD completions with identical inputs (0): none. Lost HD completions with identical inputs (0): none. These count even when a later pipeline stage fails. Their incomplete counterpart's partial HD clock is censored; these pairs are excluded from completed-pair HD ratios, and no full-stage speedup is inferred from that partial clock.

Common-clean timing excludes changed clean outcomes, so it cannot replace the complete-corpus score. HD timing requires both initial HD stages to have completed and identical captured constructor-input hashes; later repair failures do not erase that evidence. Partial HD timings from timeouts are excluded. Ratios above 1 favor the experiment; all ratios use sums, not averages of per-board ratios.

| Corpus | Common-clean vias | Common-clean wire length, mm | Maximum process RSS across all attempts, GiB |
| --- | ---: | ---: | ---: |
| srj18 | 3,397 → 3,426 (+0.85%); n=16 | 30,294.3 → 30,328.2 (+0.11%); n=13 | 2.742 → 2.376 (-13.35%) |
| srj24 | 2,740 → 2,800 (+2.19%); n=17 | 30,431.1 → 30,513.0 (+0.27%); n=17 | 7.386 → 9.997 (+35.35%) |

Via and length tradeoffs use common-clean boards with both quality values present; each cell gives that sample count. Peak RSS is the largest individual sample process, rather than aggregate runner memory; its maximum can come from different boards or failure states. An unchanged pre-HD failure can dominate that maximum, so it does not isolate solver memory. Per-sample memory is retained in the CSV. Missing quality values stay blank and are not inferred from provisional HD output.

**Metric-coverage limitation, srj18 wire length (mm):** 13/16 common-clean pairs have finite values on both revisions. Missing control: srj18-003, srj18-008, srj18-009; missing experiment: srj18-003, srj18-008, srj18-009. Metric coverage is separate from the complete 84-record benchmark execution.

| Corpus | Identical captured HD inputs | Identical upstream failure signature | Same upstream failure phase |
| --- | ---: | ---: | ---: |
| srj18 | 16/16 | 0 | 0 |
| srj24 | 24/26 | 2 | 2 |

Upstream counts are the harness's failures before either HD input was captured: exact signature also requires equal error text and timeout status. These are reported separately from HD algorithm evidence. A changed upstream input or a later-stage failure limits causal attribution; a useful same-input HD improvement can still be measured.

| Aggregated HD diagnostic | Dataset18, control → experiment | Dataset24, control → experiment |
| --- | ---: | ---: |
| `compactA01AlreadyVisited` | 0 → 21,255,581 | 0 → 49,521,752 |
| `compactA01Candidates` | 0 → 15,603 | 0 → 29,018 |
| `compactA01Enqueued` | 0 → 80,247,006 | 0 → 185,453,735 |
| `compactA01Expanded` | 0 → 43,892,334 | 0 → 92,738,874 |
| `compactA01MaterializedPathLabels` | 0 → 1,072,358 | 0 → 2,800,063 |
| `compactA01PeakLabels` | 0 → 595,507 | 0 → 2,850,379 |
| `compactA01PeakOpen` | 0 → 87,856 | 0 → 314,704 |
| `compactA01Popped` | 0 → 65,221,242 | 0 → 142,501,672 |
| `compactA01PrunedEquivalent` | 0 → 120,177,670 | 0 → 309,581,658 |
| `compactA01Searches` | 0 → 75,199 | 0 → 246,525 |
| `compactA01UnsupportedCandidates` | 0 → 222 | 0 → 2,933 |

These counters aggregate the observed initial-HD attempt paths, including failed or timed-out boards; coverage depends on how far each run progressed. Uninstrumented control counters are shown as 0, meaning no recorded experimental event. Counter reductions alone do not establish faster or cleaner routing. Full numeric totals and per-sample values are retained beside this report.

Source: [paired benchmark run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40634262592), attempt 1. Finished 2026-10-28T05:43:44.992400+00:00. Decoded input SHA-256: `07d56afd311aec9b6f333bd4c729f3c7f19ba2689c0ef6f3949b75b088305baa`.

Artifacts: [42 paired samples](per-sample.csv) and [numeric diagnostics](diagnostics.json).
