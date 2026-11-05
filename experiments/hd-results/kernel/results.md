# Compact A01 frontier: paired experiment results

Observed fixed-corpus score: 5,066.8 → 4,970.9 (-1.89%) s; clean boards 33/42 → 33/42.

Control `637b6c581128238f6c61227a1c15be423d24baca`; experiment `2f5eb0b7a4602c86df32c2554c68abc7f4554eb3`. All 84 fresh-process records are present: 16 dataset18 and 26 dataset24 samples per revision. Pipeline 9, effort 1, one routing thread/sample, Bun 1.4.3, 6 sample lanes and a 360-second timeout. Both passes use one resolved dependency tree on the same runner; control ran first. This is one exploratory pair, without repeat/randomization or a significance estimate.

Resource profile: **6-lane resource followup**. This report describes only this run; 3-lane originals and 6-lane resource followups remain separate evidence and are not pooled.

| Corpus | Solved, control → experiment | Clean, control → experiment | Timeouts | Other failures | Fixed-corpus score, s | Score ratio, control/experiment |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| srj18 (16) | 16 → 16 | 16 → 16 | 0 → 0 | 0 → 0 | 999.4 → 938.7 (-6.07%) | 1.065× |
| srj24 (26) | 19 → 19 | 17 → 17 | 6 → 6 | 1 → 1 | 4,067.3 → 4,032.2 (-0.86%) | 1.009× |

The fixed-corpus score uses measured routing time for a solved, relaxed-DRC-clean board and assigns 360 seconds to every other outcome, including early failures and solved-but-unclean boards. Lower is better. It is a comparison score, not actual total wall time. Clean means the repository's relaxed benchmark DRC, rather than every manufacturing rule.

| Corpus | Common-clean boards | Routing time on common-clean boards, s | Routing ratio | Same-input completed HD pairs | Initial HD time, s | HD ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| srj18 | 16 | 999.4 → 938.7 (-6.07%) | 1.065× | 16 | 336.5 → 316.8 (-5.86%) | 1.062× |
| srj24 | 17 | 827.3 → 792.2 (-4.25%) | 1.044× | 21 | 638.3 → 605.2 (-5.18%) | 1.055× |
| Both | 33 | 1,826.8 → 1,730.9 (-5.25%) | 1.055× | 37 | 974.8 → 922.0 (-5.41%) | 1.057× |

New clean outcomes (0): none. Lost clean outcomes (0): none.

New HD completions with identical inputs (0): none. Lost HD completions with identical inputs (0): none. These count even when a later pipeline stage fails. Their incomplete counterpart's partial HD clock is censored; these pairs are excluded from completed-pair HD ratios, and no full-stage speedup is inferred from that partial clock.

Common-clean timing excludes changed clean outcomes, so it cannot replace the complete-corpus score. HD timing requires both initial HD stages to have completed and identical captured constructor-input hashes; later repair failures do not erase that evidence. Partial HD timings from timeouts are excluded. Ratios above 1 favor the experiment; all ratios use sums, not averages of per-board ratios.

| Corpus | Common-clean vias | Common-clean wire length, mm | Maximum process RSS across all attempts, GiB |
| --- | ---: | ---: | ---: |
| srj18 | 3,397 → 3,397 (+0.00%); n=16 | 30,294.3 → 30,294.3 (+0.00%); n=13 | 2.806 → 2.819 (+0.48%) |
| srj24 | 2,740 → 2,740 (+0.00%); n=17 | 30,431.1 → 30,431.1 (+0.00%); n=17 | 8.911 → 6.091 (-31.64%) |

Via and length tradeoffs use common-clean boards with both quality values present; each cell gives that sample count. Peak RSS is the largest individual sample process, rather than aggregate runner memory; its maximum can come from different boards or failure states. An unchanged pre-HD failure can dominate that maximum, so it does not isolate solver memory. Per-sample memory is retained in the CSV. Missing quality values stay blank and are not inferred from provisional HD output.

**Metric-coverage limitation, srj18 wire length (mm):** 13/16 common-clean pairs have finite values on both revisions. Missing control: srj18-003, srj18-008, srj18-009; missing experiment: srj18-003, srj18-008, srj18-009. Metric coverage is separate from the complete 84-record benchmark execution.

| Corpus | Identical captured HD inputs | Identical upstream failure signature | Same upstream failure phase |
| --- | ---: | ---: | ---: |
| srj18 | 16/16 | 0 | 0 |
| srj24 | 24/26 | 2 | 2 |

Upstream counts are the harness's failures before either HD input was captured: exact signature also requires equal error text and timeout status. These are reported separately from HD algorithm evidence. A changed upstream input or a later-stage failure limits causal attribution; a useful same-input HD improvement can still be measured.

| Aggregated HD diagnostic | Dataset18, control → experiment | Dataset24, control → experiment |
| --- | ---: | ---: |
| `compactA01AlreadyVisited` | 0 → 71,758,947 | 0 → 187,248,822 |
| `compactA01Candidates` | 0 → 15,668 | 0 → 28,160 |
| `compactA01Enqueued` | 0 → 116,983,167 | 0 → 301,669,914 |
| `compactA01Expanded` | 0 → 25,823,534 | 0 → 52,210,779 |
| `compactA01MaterializedPathLabels` | 0 → 798,335 | 0 → 2,113,718 |
| `compactA01PeakLabels` | 0 → 1,059,020 | 0 → 7,192,965 |
| `compactA01PeakOpen` | 0 → 168,555 | 0 → 627,438 |
| `compactA01Popped` | 0 → 97,632,215 | 0 → 239,629,927 |
| `compactA01PrunedEquivalent` | 0 → 0 | 0 → 0 |
| `compactA01Searches` | 0 → 51,778 | 0 → 175,860 |
| `compactA01StorageOnlyCandidates` | 0 → 15,668 | 0 → 28,160 |
| `compactA01UnsupportedCandidates` | 0 → 221 | 0 → 2,826 |

These counters aggregate the observed initial-HD attempt paths, including failed or timed-out boards; coverage depends on how far each run progressed. Uninstrumented control counters are shown as 0, meaning no recorded experimental event. Counter reductions alone do not establish faster or cleaner routing. Full numeric totals and per-sample values are retained beside this report.

Source: [paired benchmark run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40643347643), attempt 1. Finished 2026-10-28T06:59:45.621555+00:00. Decoded input SHA-256: `1128ea9867aac043b0bd12d2362598a0b7f70678813fcf71c25ad9f2badc4008`.

Artifacts: [42 paired samples](per-sample.csv) and [numeric diagnostics](diagnostics.json).

Broader validation: Build and all nine BunTest shards passed on this storage-only source; the separate Format Check remains failed. See [validation evidence](validation.json) for exact runs and scope.

All recorded stage comparisons, including per-stage cohort counts and interpretation limits: [stage timings](stage-times.json).

Reproduction dependency snapshot: [verified experiment-only Bun lock](../resolved-dependencies-261a3861.bun.lock) (SHA-256 `261a3861619cd4aa6265d2c9b75825a49196002d59ad665dddd69c67378ed1ee`). This archive does not change project dependencies. To reproduce the measured resolution, prepopulate the paired controller’s `--deps` directory with these exact bytes named `bun.lock` before its normal install; use recorded Bun 1.4.3 and the matching package manifest.

Whole-output parity: all 35 common-solved boards have identical final output hashes. Dataset24's sum of per-board peak RSS on its 19 common-solved boards is 34.083→34.969 GiB; the lower all-attempt maximum mainly concerns capped work, so it is not uniform memory reduction. Unchanged upstream port-point work is also about 4% faster in the experiment pass, limiting causal attribution of this single control-first timing difference.
