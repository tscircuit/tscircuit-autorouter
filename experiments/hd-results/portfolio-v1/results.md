# Selective portfolio scheduling: paired experiment results

Observed fixed-corpus score: 4,903.0 → 5,242.3 (+6.92%) s; clean boards 33/42 → 32/42.

Control `637b6c581128238f6c61227a1c15be423d24baca`; experiment `69f911acf376cef278780f307184aee151d64741`. All 84 fresh-process records are present: 16 dataset18 and 26 dataset24 samples per revision. Pipeline 9, effort 1, one routing thread/sample, Bun 1.4.3, 3 sample lanes and a 360-second timeout. Both passes use one resolved dependency tree on the same runner; control ran first. This is one exploratory pair, without repeat/randomization or a significance estimate.

Resource profile: **3-lane original**. This report describes only this run; 3-lane originals and 6-lane resource followups remain separate evidence and are not pooled.

| Corpus | Solved, control → experiment | Clean, control → experiment | Timeouts | Other failures | Fixed-corpus score, s | Score ratio, control/experiment |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| srj18 (16) | 16 → 16 | 16 → 15 | 0 → 0 | 0 → 0 | 908.8 → 1,264.2 (+39.10%) | 0.719× |
| srj24 (26) | 19 → 19 | 17 → 17 | 6 → 6 | 1 → 1 | 3,994.2 → 3,978.1 (-0.40%) | 1.004× |

The fixed-corpus score uses measured routing time for a solved, relaxed-DRC-clean board and assigns 360 seconds to every other outcome, including early failures and solved-but-unclean boards. Lower is better. It is a comparison score, not actual total wall time. Clean means the repository's relaxed benchmark DRC, rather than every manufacturing rule.

| Corpus | Common-clean boards | Routing time on common-clean boards, s | Routing ratio | Same-input completed HD pairs | Initial HD time, s | HD ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| srj18 | 15 | 885.2 → 904.2 (+2.15%) | 0.979× | 16 | 313.7 → 236.6 (-24.59%) | 1.326× |
| srj24 | 17 | 754.2 → 738.1 (-2.13%) | 1.022× | 21 | 584.4 → 406.7 (-30.40%) | 1.437× |
| Both | 32 | 1,639.4 → 1,642.3 (+0.18%) | 0.998× | 37 | 898.2 → 643.3 (-28.37%) | 1.396× |

New clean outcomes (0): none. Lost clean outcomes (1): srj18-009.

New HD completions with identical inputs (0): none. Lost HD completions with identical inputs (0): none. These count even when a later pipeline stage fails. Their incomplete counterpart's partial HD clock is censored; these pairs are excluded from completed-pair HD ratios, and no full-stage speedup is inferred from that partial clock.

Common-clean timing excludes changed clean outcomes, so it cannot replace the complete-corpus score. HD timing requires both initial HD stages to have completed and identical captured constructor-input hashes; later repair failures do not erase that evidence. Partial HD timings from timeouts are excluded. Ratios above 1 favor the experiment; all ratios use sums, not averages of per-board ratios.

| Corpus | Common-clean vias | Common-clean wire length, mm | Maximum process RSS across all attempts, GiB |
| --- | ---: | ---: | ---: |
| srj18 | 3,282 → 3,387 (+3.20%); n=15 | 30,294.3 → 30,140.7 (-0.51%); n=13 | 2.614 → 2.989 (+14.33%) |
| srj24 | 2,740 → 2,784 (+1.61%); n=17 | 27,372.3 → 27,247.5 (-0.46%); n=16 | 8.898 → 9.515 (+6.94%) |

Via and length tradeoffs use common-clean boards with both quality values present; each cell gives that sample count. Peak RSS is the largest individual sample process, rather than aggregate runner memory; its maximum can come from different boards or failure states. An unchanged pre-HD failure can dominate that maximum, so it does not isolate solver memory. Per-sample memory is retained in the CSV. Missing quality values stay blank and are not inferred from provisional HD output.

**Metric-coverage limitation, srj18 wire length (mm):** 13/15 common-clean pairs have finite values on both revisions. Missing control: srj18-003, srj18-008; missing experiment: srj18-003, srj18-008. Metric coverage is separate from the complete 84-record benchmark execution.

**Metric-coverage limitation, srj24 wire length (mm):** 16/17 common-clean pairs have finite values on both revisions. Missing control: none; missing experiment: srj24-021. The original summary aggregate 30,431.13 → 27,247.53 is not used; recomputing only matched finite pairs gives 27,372.26 → 27,247.53. Missing values were treated as zero by the original summarizer, which can compare different board sets. Metric coverage is separate from the complete 84-record benchmark execution.

| Corpus | Identical captured HD inputs | Identical upstream failure signature | Same upstream failure phase |
| --- | ---: | ---: | ---: |
| srj18 | 16/16 | 0 | 0 |
| srj24 | 24/26 | 2 | 2 |

Upstream counts are the harness's failures before either HD input was captured: exact signature also requires equal error text and timeout status. These are reported separately from HD algorithm evidence. A changed upstream input or a later-stage failure limits causal attribution; a useful same-input HD improvement can still be measured.

| Aggregated HD diagnostic | Dataset18, control → experiment | Dataset24, control → experiment |
| --- | ---: | ---: |
| `portfolioSelectiveAdmitted` | 0 → 71,167 | 0 → 146,512 |
| `portfolioSelectiveAttempts` | 0 → 14,876 | 0 → 28,716 |
| `portfolioSelectiveCpuMicros` | 0 → 190,844,283 | 0 → 557,772,496 |
| `portfolioSelectiveElapsedMicros` | 0 → 185,206,065 | 0 → 547,653,899 |
| `portfolioSelectiveUnconstructed` | 0 → 713,877 | 0 → 1,413,803 |
| `portfolioSelectiveUnknownAttempts` | 0 → 189 | 0 → 887 |
| `portfolioSelectiveWallMicros` | 0 → 190,870,817 | 0 → 557,882,563 |

These counters aggregate the observed initial-HD attempt paths, including failed or timed-out boards; coverage depends on how far each run progressed. Uninstrumented control counters are shown as 0, meaning no recorded experimental event. Counter reductions alone do not establish faster or cleaner routing. Full numeric totals and per-sample values are retained beside this report.

Source: [paired benchmark run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40634267642), attempt 1. Finished 2026-10-28T05:42:28.788958+00:00. Decoded input SHA-256: `b4a02d9e49bf657c1049f5cb80a7717596469bd2aca05ea099ecb7be920807fa`.

V1 scheduling clock: **process CPU** (`process.cpuUsage()`), not thread-local CPU. The run used one routing thread per sample. Final v2 prefers `threadCpu` where supported; its separate full-dataset follow-up remains pending and is not represented by this report.

Artifacts: [42 paired samples](per-sample.csv) and [numeric diagnostics](diagnostics.json). [Artifact verification](artifact-verification.json) and [report provenance](report-provenance.json) preserve the exact measured revision.
