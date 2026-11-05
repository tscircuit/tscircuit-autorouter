# Sparse corridor search: paired experiment results

Observed fixed-corpus score: 5,018.7 → 5,166.6 (+2.95%) s; clean boards 33/42 → 33/42.

Control `637b6c581128238f6c61227a1c15be423d24baca`; experiment `c0404627d9f134302b1893e0930c8c4d6540d1d6`. All 84 fresh-process records are present: 16 dataset18 and 26 dataset24 samples per revision. Pipeline 9, effort 1, one routing thread/sample, Bun 1.4.3, 6 sample lanes and a 360-second timeout. Both passes use one resolved dependency tree on the same runner; control ran first. This is one exploratory pair, without repeat/randomization or a significance estimate.

Resource profile: **6-lane resource followup**. This report describes only this run; 3-lane originals and 6-lane resource followups remain separate evidence and are not pooled.

| Corpus | Solved, control → experiment | Clean, control → experiment | Timeouts | Other failures | Fixed-corpus score, s | Score ratio, control/experiment |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| srj18 (16) | 16 → 16 | 16 → 16 | 0 → 0 | 0 → 0 | 977.3 → 1,037.1 (+6.12%) | 0.942× |
| srj24 (26) | 19 → 19 | 17 → 17 | 6 → 6 | 1 → 1 | 4,041.4 → 4,129.5 (+2.18%) | 0.979× |

The fixed-corpus score uses measured routing time for a solved, relaxed-DRC-clean board and assigns 360 seconds to every other outcome, including early failures and solved-but-unclean boards. Lower is better. It is a comparison score, not actual total wall time. Clean means the repository's relaxed benchmark DRC, rather than every manufacturing rule.

| Corpus | Common-clean boards | Routing time on common-clean boards, s | Routing ratio | Same-input completed HD pairs | Initial HD time, s | HD ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| srj18 | 16 | 977.3 → 1,037.1 (+6.12%) | 0.942× | 16 | 332.3 → 347.1 (+4.44%) | 0.957× |
| srj24 | 17 | 801.4 → 889.5 (+10.99%) | 0.901× | 21 | 618.6 → 636.7 (+2.92%) | 0.972× |
| Both | 33 | 1,778.7 → 1,926.6 (+8.31%) | 0.923× | 37 | 950.9 → 983.8 (+3.45%) | 0.967× |

New clean outcomes (0): none. Lost clean outcomes (0): none.

New HD completions with identical inputs (0): none. Lost HD completions with identical inputs (0): none. These count even when a later pipeline stage fails. Their incomplete counterpart's partial HD clock is censored; these pairs are excluded from completed-pair HD ratios, and no full-stage speedup is inferred from that partial clock.

Common-clean timing excludes changed clean outcomes, so it cannot replace the complete-corpus score. HD timing requires both initial HD stages to have completed and identical captured constructor-input hashes; later repair failures do not erase that evidence. Partial HD timings from timeouts are excluded. Ratios above 1 favor the experiment; all ratios use sums, not averages of per-board ratios.

| Corpus | Common-clean vias | Common-clean wire length, mm | Maximum process RSS across all attempts, GiB |
| --- | ---: | ---: | ---: |
| srj18 | 3,397 → 3,379 (-0.53%); n=16 | 30,294.3 → 31,839.3 (+5.10%); n=13 | 2.803 → 2.802 (-0.04%) |
| srj24 | 2,740 → 2,751 (+0.40%); n=17 | 27,372.3 → 28,342.4 (+3.54%); n=16 | 7.417 → 7.633 (+2.91%) |

Via and length tradeoffs use common-clean boards with both quality values present; each cell gives that sample count. Peak RSS is the largest individual sample process, rather than aggregate runner memory; its maximum can come from different boards or failure states. An unchanged pre-HD failure can dominate that maximum, so it does not isolate solver memory. Per-sample memory is retained in the CSV. Missing quality values stay blank and are not inferred from provisional HD output.

**Metric-coverage limitation, srj18 wire length (mm):** 13/16 common-clean pairs have finite values on both revisions. Missing control: srj18-003, srj18-008, srj18-009; missing experiment: srj18-003, srj18-008, srj18-009. Metric coverage is separate from the complete 84-record benchmark execution.

**Metric-coverage limitation, srj24 wire length (mm):** 16/17 common-clean pairs have finite values on both revisions. Missing control: none; missing experiment: srj24-021. The original summary aggregate 30,431.13 → 28,342.41 is not used; recomputing only matched finite pairs gives 27,372.26 → 28,342.41. Missing values were treated as zero by the original summarizer, which can compare different board sets. Metric coverage is separate from the complete 84-record benchmark execution.

| Corpus | Identical captured HD inputs | Identical upstream failure signature | Same upstream failure phase |
| --- | ---: | ---: | ---: |
| srj18 | 16/16 | 0 | 0 |
| srj24 | 24/26 | 2 | 2 |

Upstream counts are the harness's failures before either HD input was captured: exact signature also requires equal error text and timeout status. These are reported separately from HD algorithm evidence. A changed upstream input or a later-stage failure limits causal attribution; a useful same-input HD improvement can still be measured.

| Aggregated HD diagnostic | Dataset18, control → experiment | Dataset24, control → experiment |
| --- | ---: | ---: |
| `sparseBoardValidationCalls` | 0 → 5,134 | 0 → 7,934 |
| `sparseBoardValidationIssues` | 0 → 90 | 0 → 184 |
| `sparseBroadphaseTests` | 0 → 35,494,859 | 0 → 45,414,090 |
| `sparseEdgesChecked` | 0 → 4,200,233 | 0 → 6,933,530 |
| `sparseEvents` | 0 → 139,572 | 0 → 197,269 |
| `sparseExpandedStates` | 0 → 244,460 | 0 → 469,644 |
| `sparseGeometryTests` | 0 → 6,092,424 | 0 → 9,216,209 |
| `sparseInstances` | 0 → 14,818 | 0 → 26,654 |
| `sparseOrdersAttempted` | 0 → 7,238 | 0 → 11,462 |
| `sparseRefinements` | 0 → 9,623 | 0 → 15,077 |
| `sparseSearchTimeMs` | 0.000 → 33,314.544 | 0.000 → 62,769.597 |
| `sparseSolvedTasks` | 0 → 17,015 | 0 → 25,905 |
| `sparseUnknown` | 0 → 9,678 | 0 → 18,714 |
| `sparseWins` | 0 → 5,096 | 0 → 7,902 |

These counters aggregate the observed initial-HD attempt paths, including failed or timed-out boards; coverage depends on how far each run progressed. Uninstrumented control counters are shown as 0, meaning no recorded experimental event. Counter reductions alone do not establish faster or cleaner routing. Full numeric totals and per-sample values are retained beside this report.

Source: [paired benchmark run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40643477845), attempt 1. Finished 2026-10-28T07:01:20.113132+00:00. Decoded input SHA-256: `5a361fe330a67f2bce02a5c4e19fecfaafc84f0e42c74aac11a1de7810e89cca`.

Artifacts: [42 paired samples](per-sample.csv) and [numeric diagnostics](diagnostics.json).

Broader validation remains blocked: Build passed, but all nine BunTest shards failed, including substantive DRC/shape assertions and changed SVGs. Supplemental SVG-bypassed A64 numerical checks passed; USB-shield ended with three DRC errors while the unchanged baseline passed. These probes do not make actual CI green or erase independent dataset performance evidence. See [validation evidence](validation.json).

All recorded stage comparisons, including per-stage cohort counts and interpretation limits: [stage timings](stage-times.json).

Reproduction dependency snapshot: [verified experiment-only Bun lock](../resolved-dependencies-261a3861.bun.lock) (SHA-256 `261a3861619cd4aa6265d2c9b75825a49196002d59ad665dddd69c67378ed1ee`). This archive does not change project dependencies. To reproduce the measured resolution, prepopulate the paired controller’s `--deps` directory with these exact bytes named `bun.lock` before its normal install; use recorded Bun 1.4.3 and the matching package manifest.
