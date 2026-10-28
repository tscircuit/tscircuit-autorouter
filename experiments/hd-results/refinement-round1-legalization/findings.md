# Legalization refinement findings — run 40740148169

All 210 records, exact source refs, shared Bun 1.4.3 lock, six pinned CPU lanes and the capacity-gated 64-GiB reservation profile independently authenticate. Every measured summary value was rebuilt from raw records. Archive completeness is false solely because `protocol/.gitignore` was omitted by artifact packaging; all executable/configuration protocol bytes and raw records are present. See `rendered/legalization-40740148169/` for full tables and exact cohorts.

| Arm | Dataset 18 clean | Dataset 24 clean | Combined clean | Timeouts |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 16 | 17 | 33 | 6 |
| Old full | 16 | 19 | 35 | 5 |
| Compression only | 15 | 18 | 33 | 6 |
| Refined full | 16 | 18 | 34 | 6 |
| Selective | 16 | 18 | 34 | 6 |

The proposed selective default does not outperform old full. It loses dataset 24 sample 11, which old full solves clean in 307.4 s; selective times out in effortCleanupSolver and refined full times out in pipeline9JointDrcRepairSolver. Both complete initial HD with the same 270809 reported HD iterations as old full. Their HD times are 143.0 s and 146.5 s versus 143.1 s old full. This is a consequential downstream geometry/repair change, not an initial-HD completion regression or unrelated upstream failure. Neither refined arm records an obstacle/board guard rejection for this board; source-level attribution still needs inspection.

Both refined physical modes retain every baseline-clean board and recover dataset 24 sample 2 (baseline 30 DRC errors). Compression also recovers sample2, but loses dataset 18 sample 15 with 174 DRC errors; this rules out promoting compression alone despite lower timings on common-clean cohorts. Compression DRC error types include accidental trace/pad/via contacts and via/pad clearances.

Selective routing time on all 16 common-clean dataset 18 boards increases 1188.6→1302.4 s (+9.6%). The major measured phase change is joint DRC repair 207.2→333.0 s, while HD 389.6→404.1 s and HD repair 59.5→46.9 s. Dataset24 baseline-common-clean routing changes 1007.3→991.8 s (−1.5%,17 boards), which is small exploratory evidence from one observation per arm/board. Refined full is closer to baseline: dataset 18 routing 1188.6→1196.5 s (+0.7%); dataset 24 common-clean 1007.3→998.9 s (−0.8%). It still loses old full's sample 11.

Refined full's fixed-corpus penalty score is 5247.6 s versus 5272.0 s old full, but this small score change does not erase its lost clean board. Selective's score 5412.7 s is worse than old full. The score applies 360 s to every nonclean outcome and is neither total runner wall time nor a direct substitute for clean-board count.

These are new observer/resource measurements and must remain separate from historical cohorts. Every strict raw-constructor completed-HD cohort here has the same input hashes; all 16 dataset 18 and 21 dataset 24 pairs have equal reported HD iteration counts. Exact final pipeline iteration counts are unmeasured. Whole-routing elapsed excludes outer pipeline construction and final DRC; HD stage timing excludes top-level HD construction/input capture but includes per-node setup. Phase sums must not be presented as exact overall elapsed.
