# Refinement matrix: portfolio-source-ablation

This is a **compact publication view** of this completed measured round. Numerical tables and prose values below are unchanged. The [compact sample CSV](arm-samples-compact.csv) retains every arm/board row and exact core values; the [complete report archive](ARCHIVE.md) retains all eleven original renderer files byte-for-byte. References to paired records or accompanying JSON/CSV include those archive members. [Findings](findings.md) are preserved from this measured round; “current” in that historical interpretation refers to its measured source, not later PR heads.

Verified 168 fresh-process runs: all 16 dataset 18 and 26 dataset 24 boards in each of 4 exact source arms. Pipeline 9, effort 1, Bun 1.4.3, one routing thread per sample and a 360-second routing limit.

Resource profile: **refinement-64GiB**, 6 pinned sample lanes, CPUs [0, 1, 2, 3, 4, 5]. Every arm shares the pinned `261a3861…` frozen dependency resolution. Planned order uses seed 2026102809 with shuffled boards and balanced rotating arm order; memory admission can reorder realized starts. This is one exploratory observation per board and arm, without confidence intervals or equal realized co-runner guarantees.

The portfolio role text is the frozen protocol label. The final eager/lazy sources preserve the legacy A01/A03 candidate eligibility and output contracts; physical width/endpoint policy changes are confined to research-race mode. The eager/lazy contrast measures deferred setup under this shared legacy policy. Route, work and outcome parity are evaluated below and in the paired records.

This refinement observer records original loaded-SRJ/scenario identity before timing. Its worker/protocol differs from previous rounds, which must remain separate evidence. No solver mode or constructor override was injected.

| Arm | Exact measured source | Declared role |
| --- | --- | --- |
| `control` | `637b6c581128238f6c61227a1c15be423d24baca` | Historical baseline Pipeline9 |
| `old-clock` | `c7f2715d98117a4b28dbe9fcaceab873a0cd72cd` | Previously measured historical CPU-timed race (thread CPU preferred; process CPU/elapsed fallback) |
| `refined-eager` | `bf90a4eefbc2c444671861ddf59ec3f21ae12c70` | Corrected deterministic portfolio with eager grid setup; source-derived factory default |
| `refined-lazy` | `c879c9d5f4689502a279ed9d92a0299946eafcfb` | Corrected deterministic portfolio with lazy grid setup; published PR default |

| Dataset | Arm | Solved | Clean | Unclean solved | Timeouts | Other fail | Fixed-corpus score, s | Peak RSS, GiB (coverage) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| srj18 | control | 16/16 | 16/16 | 0 | 0 | 0 | 1,036.3 | 2.750 (16/16) |
| srj18 | old-clock | 16/16 | 16/16 | 0 | 0 | 0 | 1,133.2 | 6.757 (16/16) |
| srj18 | refined-eager | 16/16 | 16/16 | 0 | 0 | 0 | 1,033.6 | 2.380 (16/16) |
| srj18 | refined-lazy | 16/16 | 16/16 | 0 | 0 | 0 | 1,098.2 | 3.489 (16/16) |
| srj24 | control | 19/26 | 17/26 | 2 | 6 | 1 | 4,171.5 | 6.851 (26/26) |
| srj24 | old-clock | 19/26 | 18/26 | 1 | 6 | 1 | 4,034.6 | 14.286 (26/26) |
| srj24 | refined-eager | 19/26 | 17/26 | 2 | 6 | 1 | 4,160.8 | 6.365 (26/26) |
| srj24 | refined-lazy | 19/26 | 17/26 | 2 | 6 | 1 | 4,177.8 | 7.102 (26/26) |

The fixed-corpus score uses measured routing time for clean solved boards and 360 seconds for every other outcome. It is a comparison score, not total runner wall time. Clean means the existing benchmark relaxed DRC, not every manufacturing rule. Per-process peak RSS is not simultaneous runner memory or isolated solver memory.

| Dataset | Direct contrast | Common-clean routing, s (n) | Board ratio | Strict raw-constructor HD, s (n) | Strict HD ratio | Same loaded-SRJ HD, s (n) | Source-SRJ HD ratio |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| srj18 | control → old-clock | 1,036.3 → 1,133.2 (16) | 0.914× | 348.6 → 283.0 (16) | 1.232× | 348.6 → 283.0 (16) | 1.232× |
| srj24 | control → old-clock | 931.5 → 967.0 (17) | 0.963× | 679.2 → 490.5 (21) | 1.385× | 679.2 → 490.5 (21) | 1.385× |
| srj18 | control → refined-eager | 1,036.3 → 1,033.6 (16) | 1.003× | 348.6 → 349.9 (16) | 0.996× | 348.6 → 349.9 (16) | 0.996× |
| srj24 | control → refined-eager | 931.5 → 920.8 (17) | 1.012× | 679.2 → 669.3 (21) | 1.015× | 679.2 → 669.3 (21) | 1.015× |
| srj18 | control → refined-lazy | 1,036.3 → 1,098.2 (16) | 0.944× | 348.6 → 406.2 (16) | 0.858× | 348.6 → 406.2 (16) | 0.858× |
| srj24 | control → refined-lazy | 931.5 → 937.8 (17) | 0.993× | 679.2 → 770.8 (21) | 0.881× | 679.2 → 770.8 (21) | 0.881× |
| srj18 | old-clock → refined-lazy | 1,133.2 → 1,098.2 (16) | 1.032× | 283.0 → 406.2 (16) | 0.697× | 283.0 → 406.2 (16) | 0.697× |
| srj24 | old-clock → refined-lazy | 967.0 → 937.8 (17) | 1.031× | 490.5 → 770.8 (21) | 0.636× | 490.5 → 770.8 (21) | 0.636× |
| srj18 | refined-eager → refined-lazy | 1,033.6 → 1,098.2 (16) | 0.941× | 349.9 → 406.2 (16) | 0.861× | 349.9 → 406.2 (16) | 0.861× |
| srj24 | refined-eager → refined-lazy | 920.8 → 937.8 (17) | 0.982× | 669.3 → 770.8 (21) | 0.868× | 669.3 → 770.8 (21) | 0.868× |

**The two HD columns answer different questions.** Strict raw-constructor timing requires identical original serialized constructor hashes. Same loaded-SRJ timing requires identical pre-solve source board hashes, but constructor fields or declared physical clearance rules may differ. It is not configuration-equivalent evidence. Scenario hashes are recorded separately and never replace SRJ equality. No fields or hashes were normalized to create a cohort.

Both HD timing cohorts require completion on both sides. A partial timeout clock is censored and excluded; recovered or lost completions are listed separately. Common-clean routing excludes changed clean outcomes, so it cannot replace the fixed-corpus score. Ratios above 1 favor the after arm.

| Dataset | Contrast | New clean boards | Lost clean boards | New/lost completed HD, strict raw | New/lost completed HD, same SRJ |
| --- | --- | --- | --- | --- | --- |
| srj18 | baseline-vs-old-clock | none | none | none / none | none / none |
| srj24 | baseline-vs-old-clock | srj24-002 | none | none / none | none / none |
| srj18 | baseline-vs-eager | none | none | none / none | none / none |
| srj24 | baseline-vs-eager | none | none | none / none | none / none |
| srj18 | baseline-vs-lazy | none | none | none / none | none / none |
| srj24 | baseline-vs-lazy | none | none | none / none | none / none |
| srj18 | old-clock-vs-lazy | none | none | none / none | none / none |
| srj24 | old-clock-vs-lazy | none | srj24-002 | none / none | none / none |
| srj18 | eager-vs-lazy | none | none | none / none | none / none |
| srj24 | eager-vs-lazy | none | none | none / none | none / none |

| Dataset | Contrast | Common-clean vias, totals (n) | Finite common-clean wire, mm (n) | Output hashes, equal / known paired-solved | Strict HD iterations, equal / known |
| --- | --- | ---: | ---: | ---: | ---: |
| srj18 | baseline-vs-old-clock | 3,397.0 → 3,473.0 (16/16) | 30,294.3 → 30,247.9 (13/16) | 0/16 | 0/16 |
| srj24 | baseline-vs-old-clock | 2,740.0 → 2,757.0 (17/17) | 23,580.2 → 23,433.5 (15/17) | 1/19 | 0/21 |
| srj18 | baseline-vs-eager | 3,397.0 → 3,397.0 (16/16) | 30,294.3 → 30,294.3 (13/16) | 16/16 | 16/16 |
| srj24 | baseline-vs-eager | 2,740.0 → 2,740.0 (17/17) | 30,431.1 → 30,431.1 (17/17) | 19/19 | 21/21 |
| srj18 | baseline-vs-lazy | 3,397.0 → 3,397.0 (16/16) | 30,294.3 → 30,294.3 (13/16) | 16/16 | 16/16 |
| srj24 | baseline-vs-lazy | 2,740.0 → 2,740.0 (17/17) | 30,431.1 → 30,431.1 (17/17) | 19/19 | 21/21 |
| srj18 | old-clock-vs-lazy | 3,473.0 → 3,397.0 (16/16) | 30,247.9 → 30,294.3 (13/16) | 0/16 | 0/16 |
| srj24 | old-clock-vs-lazy | 2,757.0 → 2,740.0 (17/17) | 23,433.5 → 23,580.2 (15/17) | 1/19 | 0/21 |
| srj18 | eager-vs-lazy | 3,397.0 → 3,397.0 (16/16) | 30,294.3 → 30,294.3 (13/16) | 16/16 | 16/16 |
| srj24 | eager-vs-lazy | 2,740.0 → 2,740.0 (17/17) | 30,431.1 → 30,431.1 (17/17) | 19/19 | 21/21 |

Quality comparisons use finite values on both sides of the same common-clean cohort; missing wire lengths are never zero-filled. Output/iteration parity reports explicit known coverage and board IDs in the accompanying JSON/CSV. Exact final pipeline iteration counts are not emitted by this observer and remain unavailable. HD iterations are reported only within their stated completed cohort.

Raw constructor field/rule declarations and original SRJ rule declarations remain in every paired record. DRC counts/types/messages are retained when emitted; an unmeasured or censored DRC result is unknown, not zero. Diagnostic counter comparisons retain matched/missing coverage separately from all-observed totals. Intermediate proposal-conflict counts are not final-board DRC-error counts.

Artifacts: [per-arm summaries](arms.csv), [compact all-arm sample metrics](arm-samples-compact.csv), [direct contrast summaries](contrasts.csv), [verification](report-verification.json), and [all eleven original report files, including every paired/counter/phase/JSON table](ARCHIVE.md).

Original run: https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40744329967 (attempt 1).
