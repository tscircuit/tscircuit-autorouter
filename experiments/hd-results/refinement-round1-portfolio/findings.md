# Portfolio refinement findings — run 40744329967

All 168 records, exact source refs, shared Bun 1.4.3 lock, six pinned CPU lanes, capacity-gated 64-GiB profile and frozen protocol bytes independently authenticate. The archive is complete. Full measured reports are in `rendered/portfolio-40744329967/`.

The current lazy implementation preserves baseline behavior but is slower than eager setup on this full corpus. Eager/lazy clean counts are 16/17, identical to baseline. All 35 paired-solved final output hashes match baseline, and all 37 paired completed-HD iteration counts match. There are no new or lost clean boards versus baseline. Old clock has one extra clean board, dataset 24 sample 2, which the deterministic modes do not retain.

| Dataset | Eager HD, s | Lazy HD, s | HD elapsed change | Common-clean eager routing, s | Common-clean lazy routing, s | Routing elapsed change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
|18 |349.9 |406.2 |+16.1% |1033.6 |1098.2 |+6.3% |
|24 |669.3 |770.8 |+15.2% |920.8 |937.8 |+1.8% |

The mechanism does skip setup, rather than merely moving it outside the measured HD stage. On the strict completed-HD cohorts, dataset 18 eagerly initializes 30708 grids; lazy initializes 493 upfront and 4269 on demand, skipping 25946 (84.5%). Dataset 24's 21-board cohort initializes 42647 eager versus 828 upfront plus 5870 on demand, skipping 35949 (84.3%). Portfolio attempt/solved/unknown counters are exactly equal on both matched cohorts. All-observed totals on censored dataset 24 attempts differ and must not replace these matched-cohort counts.

This points to overhead in the current deferral implementation, eligibility certification or changed allocation/engine behavior despite substantial avoided setup. These mechanisms need profiling; counts alone do not identify the cause. Per-node setup remains inside the HD timer; outer HD construction/input capture is outside that stage timer but inside routing elapsed. There is no support for claiming a present runtime improvement.

Historical clock racing again reduces HD time (baseline 348.6→283.0 s on 18;679.2→490.5 s on 24) but changes outputs and increases common-clean whole-routing time (1036.3→1133.2 s on 18;931.5→967.0 s on 24). Its largest observed process RSS is 14.3 GiB versus 6.9 GiB control in this matrix. The deterministic eager mode is close to baseline and exactly reproduces all 35 known solved outputs.

These are exploratory, one-observation-per-board/arm timings, not confidence estimates. They must stay separate from the legalization matrix and previous observer/resource cohorts. The current lazy default should not be presented as a demonstrated optimization.
