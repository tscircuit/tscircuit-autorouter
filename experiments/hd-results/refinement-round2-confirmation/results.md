# Refinement matrix: combined-refinement-confirmation

This is a **compact publication view** of this completed measured round. Numerical tables and prose values below are unchanged. The [compact sample CSV](arm-samples-compact.csv) retains every arm/board row and exact core values; the [complete report archive](ARCHIVE.md) retains all eleven original renderer files byte-for-byte. References to paired records or accompanying JSON/CSV include those archive members. [Findings](findings.md) are preserved from this measured round; “current” in that historical interpretation refers to its measured source, not later PR heads.

Verified 168 fresh-process runs: all 16 dataset 18 and 26 dataset 24 boards in each of 4 exact source arms. Pipeline 9, effort 1, Bun 1.4.3, one routing thread per sample and a 360-second routing limit.

Resource profile: **refinement-64GiB**, 6 pinned sample lanes, CPUs [0, 1, 2, 3, 4, 5]. Every arm shares the pinned `261a3861…` frozen dependency resolution. Planned order uses seed 2026102812 with shuffled boards and balanced rotating arm order; memory admission can reorder realized starts. This is one exploratory observation per board and arm, without confidence intervals or equal realized co-runner guarantees.

This matrix compares separate legalization and portfolio source candidates. Neither candidate combines both changes into one pipeline, and measured savings must not be added as a combined result. The source roles and contrasts were declared before measurement.

This confirmation reuses the exact frozen refinement observer and measurement helpers. Earlier refinement runs remain separate machine/cohort evidence; elapsed observations are not pooled. No solver mode or constructor override was injected.

| Arm | Exact measured source | Declared role |
| --- | --- | --- |
| `control` | `637b6c581128238f6c61227a1c15be423d24baca` | Historical baseline Pipeline9 |
| `old-full` | `8115e35a4517191c306820438b14a197dc911c7a` | Previously measured full physical legalization; historical source |
| `fixed-full` | `83a593a901b1209a024ab3a96bb9c191871b8df4` | Revised full physical legalization preserving declared clearances and drill guards; source under confirmation |
| `optimized-lazy` | `5b4c680c842eafe17e2830fc9a29d16d17d6a9b2` | Revised deterministic lazy setup preserving legacy A01/A03 policy; source under confirmation |

| Dataset | Arm | Solved | Clean | Unclean solved | Timeouts | Other fail | Fixed-corpus score, s | Peak RSS, GiB (coverage) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| srj18 | control | 16/16 | 16/16 | 0 | 0 | 0 | 1,054.7 | 2.802 (16/16) |
| srj18 | old-full | 16/16 | 16/16 | 0 | 0 | 0 | 1,109.5 | 4.602 (16/16) |
| srj18 | fixed-full | 16/16 | 15/16 | 1 | 0 | 0 | 1,266.5 | 4.803 (16/16) |
| srj18 | optimized-lazy | 16/16 | 16/16 | 0 | 0 | 0 | 1,061.6 | 2.858 (16/16) |
| srj24 | control | 19/26 | 17/26 | 2 | 6 | 1 | 4,167.4 | 6.047 (26/26) |
| srj24 | old-full | 20/26 | 19/26 | 1 | 5 | 1 | 3,901.2 | 8.735 (26/26) |
| srj24 | fixed-full | 20/26 | 19/26 | 1 | 5 | 1 | 3,899.4 | 6.054 (26/26) |
| srj24 | optimized-lazy | 19/26 | 17/26 | 2 | 6 | 1 | 4,147.6 | 8.634 (26/26) |

The fixed-corpus score uses measured routing time for clean solved boards and 360 seconds for every other outcome. It is a comparison score, not total runner wall time. Clean means the existing benchmark relaxed DRC, not every manufacturing rule. Per-process peak RSS is not simultaneous runner memory or isolated solver memory.

| Dataset | Direct contrast | Common-clean routing, s (n) | Board ratio | Strict raw-constructor HD, s (n) | Strict HD ratio | Same loaded-SRJ HD, s (n) | Source-SRJ HD ratio |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| srj18 | control → old-full | 1,054.7 → 1,109.5 (16) | 0.951× | 351.5 → 368.6 (16) | 0.954× | 351.5 → 368.6 (16) | 0.954× |
| srj24 | control → old-full | 927.4 → 893.6 (17) | 1.038× | 693.6 → 709.7 (21) | 0.977× | 693.6 → 709.7 (21) | 0.977× |
| srj18 | control → fixed-full | 894.7 → 906.5 (15) | 0.987× | 351.5 → 374.0 (16) | 0.940× | 351.5 → 374.0 (16) | 0.940× |
| srj24 | control → fixed-full | 927.4 → 902.2 (17) | 1.028× | 693.6 → 723.8 (21) | 0.958× | 693.6 → 723.8 (21) | 0.958× |
| srj18 | old-full → fixed-full | 884.2 → 906.5 (15) | 0.975× | 368.6 → 374.0 (16) | 0.986× | 368.6 → 374.0 (16) | 0.986× |
| srj24 | old-full → fixed-full | 1,381.2 → 1,379.4 (19) | 1.001× | 709.7 → 723.8 (21) | 0.981× | 709.7 → 723.8 (21) | 0.981× |
| srj18 | control → optimized-lazy | 1,054.7 → 1,061.6 (16) | 0.993× | 351.5 → 358.1 (16) | 0.982× | 351.5 → 358.1 (16) | 0.982× |
| srj24 | control → optimized-lazy | 927.4 → 907.6 (17) | 1.022× | 693.6 → 693.3 (21) | 1.001× | 693.6 → 693.3 (21) | 1.001× |

**The two HD columns answer different questions.** Strict raw-constructor timing requires identical original serialized constructor hashes. Same loaded-SRJ timing requires identical pre-solve source board hashes, but constructor fields or declared physical clearance rules may differ. It is not configuration-equivalent evidence. Scenario hashes are recorded separately and never replace SRJ equality. No fields or hashes were normalized to create a cohort.

Both HD timing cohorts require completion on both sides. A partial timeout clock is censored and excluded; recovered or lost completions are listed separately. Common-clean routing excludes changed clean outcomes, so it cannot replace the fixed-corpus score. Ratios above 1 favor the after arm.

| Dataset | Contrast | New clean boards | Lost clean boards | New/lost completed HD, strict raw | New/lost completed HD, same SRJ |
| --- | --- | --- | --- | --- | --- |
| srj18 | baseline-vs-old-full | none | none | none / none | none / none |
| srj24 | baseline-vs-old-full | srj24-002, srj24-011 | none | none / none | none / none |
| srj18 | baseline-vs-fixed-full | none | srj18-015 | none / none | none / none |
| srj24 | baseline-vs-fixed-full | srj24-002, srj24-011 | none | none / none | none / none |
| srj18 | old-full-vs-fixed-full | none | srj18-015 | none / none | none / none |
| srj24 | old-full-vs-fixed-full | none | none | none / none | none / none |
| srj18 | baseline-vs-optimized-lazy | none | none | none / none | none / none |
| srj24 | baseline-vs-optimized-lazy | none | none | none / none | none / none |

| Dataset | Contrast | Common-clean vias, totals (n) | Finite common-clean wire, mm (n) | Output hashes, equal / known paired-solved | Strict HD iterations, equal / known |
| --- | --- | ---: | ---: | ---: | ---: |
| srj18 | baseline-vs-old-full | 3,397.0 → 3,413.0 (16/16) | 30,294.3 → 30,310.6 (13/16) | 3/16 | 16/16 |
| srj24 | baseline-vs-old-full | 2,740.0 → 2,741.0 (17/17) | 30,431.1 → 30,455.3 (17/17) | 7/19 | 21/21 |
| srj18 | baseline-vs-fixed-full | 3,055.0 → 3,137.0 (15/15) | 28,048.4 → 28,070.6 (12/15) | 3/16 | 16/16 |
| srj24 | baseline-vs-fixed-full | 2,740.0 → 2,724.0 (17/17) | 30,431.1 → 30,450.5 (17/17) | 6/19 | 21/21 |
| srj18 | old-full-vs-fixed-full | 3,104.0 → 3,137.0 (15/15) | 28,099.5 → 28,070.6 (12/15) | 4/16 | 16/16 |
| srj24 | old-full-vs-fixed-full | 3,529.0 → 3,520.0 (19/19) | 38,947.1 → 39,026.1 (19/19) | 7/20 | 21/21 |
| srj18 | baseline-vs-optimized-lazy | 3,397.0 → 3,397.0 (16/16) | 30,294.3 → 30,294.3 (13/16) | 16/16 | 16/16 |
| srj24 | baseline-vs-optimized-lazy | 2,740.0 → 2,740.0 (17/17) | 30,431.1 → 30,431.1 (17/17) | 19/19 | 20/21 |

Quality comparisons use finite values on both sides of the same common-clean cohort; missing wire lengths are never zero-filled. Output/iteration parity reports explicit known coverage and board IDs in the accompanying JSON/CSV. Exact final pipeline iteration counts are not emitted by this observer and remain unavailable. HD iterations are reported only within their stated completed cohort.

Raw constructor field/rule declarations and original SRJ rule declarations remain in every paired record. DRC counts/types/messages are retained when emitted; an unmeasured or censored DRC result is unknown, not zero. Diagnostic counter comparisons retain matched/missing coverage separately from all-observed totals. Intermediate proposal-conflict counts are not final-board DRC-error counts.

Artifacts: [per-arm summaries](arms.csv), [compact all-arm sample metrics](arm-samples-compact.csv), [direct contrast summaries](contrasts.csv), [verification](report-verification.json), and [all eleven original report files, including every paired/counter/phase/JSON table](ARCHIVE.md).

Original run: https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40760310372 (attempt 1).
