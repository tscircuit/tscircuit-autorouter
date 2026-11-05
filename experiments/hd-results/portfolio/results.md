# Selective portfolio scheduling: paired experiment results

Observed fixed-corpus score: 5,029.7 → 4,911.2 (-2.36%) s; clean boards 33/42 → 34/42.

Control `637b6c581128238f6c61227a1c15be423d24baca`; experiment `c7f2715d98117a4b28dbe9fcaceab873a0cd72cd`. All 84 fresh-process records are present: 16 dataset18 and 26 dataset24 samples per revision. Pipeline 9, effort 1, one routing thread/sample, Bun 1.4.3, 6 sample lanes and a 360-second timeout. Both passes use one resolved dependency tree on the same runner; control ran first. This is one exploratory pair, without repeat/randomization or a significance estimate.

Resource profile: **6-lane resource followup**. This report describes only this run; 3-lane originals and 6-lane resource followups remain separate evidence and are not pooled.

| Corpus | Solved, control → experiment | Clean, control → experiment | Timeouts | Other failures | Fixed-corpus score, s | Score ratio, control/experiment |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| srj18 (16) | 16 → 16 | 16 → 16 | 0 → 0 | 0 → 0 | 1,008.2 → 989.6 (-1.84%) | 1.019× |
| srj24 (26) | 19 → 19 | 17 → 18 | 6 → 6 | 1 → 1 | 4,021.5 → 3,921.6 (-2.48%) | 1.025× |

The fixed-corpus score uses measured routing time for a solved, relaxed-DRC-clean board and assigns 360 seconds to every other outcome, including early failures and solved-but-unclean boards. Lower is better. It is a comparison score, not actual total wall time. Clean means the repository's relaxed benchmark DRC, rather than every manufacturing rule.

| Corpus | Common-clean boards | Routing time on common-clean boards, s | Routing ratio | Same-input completed HD pairs | Initial HD time, s | HD ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| srj18 | 16 | 1,008.2 → 989.6 (-1.84%) | 1.019× | 16 | 342.6 → 256.4 (-25.15%) | 1.336× |
| srj24 | 17 | 781.5 → 888.0 (+13.64%) | 0.880× | 21 | 606.4 → 443.7 (-26.83%) | 1.367× |
| Both | 33 | 1,789.7 → 1,877.6 (+4.92%) | 0.953× | 37 | 949.0 → 700.2 (-26.22%) | 1.355× |

New clean outcomes (1): srj24-002. Lost clean outcomes (0): none.

New HD completions with identical inputs (0): none. Lost HD completions with identical inputs (0): none. These count even when a later pipeline stage fails. Their incomplete counterpart's partial HD clock is censored; these pairs are excluded from completed-pair HD ratios, and no full-stage speedup is inferred from that partial clock.

Common-clean timing excludes changed clean outcomes, so it cannot replace the complete-corpus score. HD timing requires both initial HD stages to have completed and identical captured constructor-input hashes; later repair failures do not erase that evidence. Partial HD timings from timeouts are excluded. Ratios above 1 favor the experiment; all ratios use sums, not averages of per-board ratios.

| Corpus | Common-clean vias | Common-clean wire length, mm | Maximum process RSS across all attempts, GiB |
| --- | ---: | ---: | ---: |
| srj18 | 3,397 → 3,536 (+4.09%); n=16 | 30,294.3 → 30,137.0 (-0.52%); n=13 | 2.832 → 2.732 (-3.52%) |
| srj24 | 2,740 → 2,821 (+2.96%); n=17 | 27,372.3 → 27,216.5 (-0.57%); n=16 | 7.509 → 15.691 (+108.96%) |

Via and length tradeoffs use common-clean boards with both quality values present; each cell gives that sample count. Peak RSS is the largest individual sample process, rather than aggregate runner memory; its maximum can come from different boards or failure states. An unchanged pre-HD failure can dominate that maximum, so it does not isolate solver memory. Per-sample memory is retained in the CSV. Missing quality values stay blank and are not inferred from provisional HD output.

**Metric-coverage limitation, srj18 wire length (mm):** 13/16 common-clean pairs have finite values on both revisions. Missing control: srj18-003, srj18-008, srj18-009; missing experiment: srj18-003, srj18-008, srj18-009. Metric coverage is separate from the complete 84-record benchmark execution.

**Metric-coverage limitation, srj24 wire length (mm):** 16/17 common-clean pairs have finite values on both revisions. Missing control: none; missing experiment: srj24-021. The original summary aggregate 30,431.13 → 27,216.52 is not used; recomputing only matched finite pairs gives 27,372.26 → 27,216.52. Missing values were treated as zero by the original summarizer, which can compare different board sets. Metric coverage is separate from the complete 84-record benchmark execution.

| Corpus | Identical captured HD inputs | Identical upstream failure signature | Same upstream failure phase |
| --- | ---: | ---: | ---: |
| srj18 | 16/16 | 0 | 0 |
| srj24 | 24/26 | 2 | 2 |

Upstream counts are the harness's failures before either HD input was captured: exact signature also requires equal error text and timeout status. These are reported separately from HD algorithm evidence. A changed upstream input or a later-stage failure limits causal attribution; a useful same-input HD improvement can still be measured.

| Aggregated HD diagnostic | Dataset18, control → experiment | Dataset24, control → experiment |
| --- | ---: | ---: |
| `portfolioSelectiveA03ExcludedAttempts` | 0 → 0 | 0 → 0 |
| `portfolioSelectiveAdmitted` | 0 → 70,134 | 0 → 143,907 |
| `portfolioSelectiveAttempts` | 0 → 14,864 | 0 → 28,551 |
| `portfolioSelectiveCpuMicros` | 0 → 204,475,055 | 0 → 588,239,204 |
| `portfolioSelectiveElapsedMicros` | 0 → 152,284,798 | 0 → 500,185,932 |
| `portfolioSelectiveThreadCpuAttempts` | 0 → 14,864 | 0 → 28,551 |
| `portfolioSelectiveThreadCpuMicros` | 0 → 167,408,814 | 0 → 531,119,037 |
| `portfolioSelectiveUnconstructed` | 0 → 714,658 | 0 → 1,408,466 |
| `portfolioSelectiveUnknownAttempts` | 0 → 177 | 0 → 830 |
| `portfolioSelectiveWallMicros` | 0 → 204,478,977 | 0 → 588,283,930 |

These counters aggregate the observed initial-HD attempt paths, including failed or timed-out boards; coverage depends on how far each run progressed. Uninstrumented control counters are shown as 0, meaning no recorded experimental event. Counter reductions alone do not establish faster or cleaner routing. Full numeric totals and per-sample values are retained beside this report.

Source: [paired benchmark run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40643404125), attempt 1. Finished 2026-10-28T07:00:35.826370+00:00. Decoded input SHA-256: `acede796b53e4ef537396dab46acdad1c9afcfc5359b95063a824837506164d8`.

Artifacts: [42 paired samples](per-sample.csv) and [numeric diagnostics](diagnostics.json).

Broader validation remains blocked: packed-runtime exact iteration parity and serial/worker output parity fail; the final BunTest run has eight failed shards. Supplemental SVG-bypassed numerical probes found two A64 final DRC errors and four USB-shield final DRC errors while the unchanged baseline passed both probes. These checks do not make actual CI green or erase independent dataset performance evidence. See [validation evidence](validation.json).

All recorded stage comparisons, including per-stage cohort counts and interpretation limits: [stage timings](stage-times.json).

Reproduction dependency snapshot: [verified experiment-only Bun lock](../resolved-dependencies-261a3861.bun.lock) (SHA-256 `261a3861619cd4aa6265d2c9b75825a49196002d59ad665dddd69c67378ed1ee`). This archive does not change project dependencies. To reproduce the measured resolution, prepopulate the paired controller’s `--deps` directory with these exact bytes named `bun.lock` before its normal install; use recorded Bun 1.4.3 and the matching package manifest.
