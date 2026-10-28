# Refinement matrix: legalization-source-ablation

This is a **compact publication view** of this completed measured round. Numerical tables and prose values below are unchanged. The [compact sample CSV](arm-samples-compact.csv) retains every arm/board row and exact core values; the [complete report archive](ARCHIVE.md) retains all eleven original renderer files byte-for-byte. References to paired records or accompanying JSON/CSV include those archive members. [Findings](findings.md) are preserved from this measured round; “current” in that historical interpretation refers to its measured source, not later PR heads.

Verified 210 fresh-process runs: all 16 dataset 18 and 26 dataset 24 boards in each of 5 exact source arms. Pipeline 9, effort 1, Bun 1.4.3, one routing thread per sample and a 360-second routing limit.

Resource profile: **refinement-64GiB**, 6 pinned sample lanes, CPUs [0, 1, 2, 3, 4, 5]. Every arm shares the pinned `261a3861…` frozen dependency resolution. Planned order uses seed 2026102809 with shuffled boards and balanced rotating arm order; memory admission can reorder realized starts. This is one exploratory observation per board and arm, without confidence intervals or equal realized co-runner guarantees.

Archive packaging is **incomplete**: `protocol/.gitignore` is absent. All executable/configuration protocol files, dependency lock, exact arm config, raw records and independently rebuilt summary were authenticated. The missing nonexecuting file was not recreated or represented as archived.

This refinement observer records original loaded-SRJ/scenario identity before timing. Its worker/protocol differs from previous rounds, which must remain separate evidence. No solver mode or constructor override was injected.

| Arm | Exact measured source | Declared role |
| --- | --- | --- |
| `control` | `637b6c581128238f6c61227a1c15be423d24baca` | Historical baseline Pipeline9 |
| `old-full` | `8115e35a4517191c306820438b14a197dc911c7a` | Previously measured full physical legalization; historical source |
| `compression-only` | `1b25fbf9daef4e56daaf6475c94f39b30e090633` | Refined compression-only source-derived factory default; no displacement |
| `refined-full` | `a282b66ace3a54582bc1784e3a242118cc87d316` | Refined full physical legalization with current declared rules and safety checks; source-derived factory default |
| `selective` | `70d7a1bbbc61ca474c9b696cdccba7a8bd814c14` | Refined selective physical legalization; published PR default |

| Dataset | Arm | Solved | Clean | Unclean solved | Timeouts | Other fail | Fixed-corpus score, s | Peak RSS, GiB (coverage) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| srj18 | control | 16/16 | 16/16 | 0 | 0 | 0 | 1,188.6 | 3.390 (16/16) |
| srj18 | old-full | 16/16 | 16/16 | 0 | 0 | 0 | 1,228.9 | 4.541 (16/16) |
| srj18 | compression-only | 16/16 | 15/16 | 1 | 0 | 0 | 1,333.9 | 3.402 (16/16) |
| srj18 | refined-full | 16/16 | 16/16 | 0 | 0 | 0 | 1,196.5 | 2.479 (16/16) |
| srj18 | selective | 16/16 | 16/16 | 0 | 0 | 0 | 1,302.4 | 3.077 (16/16) |
| srj24 | control | 19/26 | 17/26 | 2 | 6 | 1 | 4,247.3 | 6.245 (26/26) |
| srj24 | old-full | 20/26 | 19/26 | 1 | 5 | 1 | 4,043.2 | 6.149 (26/26) |
| srj24 | compression-only | 19/26 | 18/26 | 1 | 6 | 1 | 4,013.1 | 6.699 (26/26) |
| srj24 | refined-full | 19/26 | 18/26 | 1 | 6 | 1 | 4,051.2 | 5.918 (26/26) |
| srj24 | selective | 19/26 | 18/26 | 1 | 6 | 1 | 4,110.3 | 6.626 (26/26) |

The fixed-corpus score uses measured routing time for clean solved boards and 360 seconds for every other outcome. It is a comparison score, not total runner wall time. Clean means the existing benchmark relaxed DRC, not every manufacturing rule. Per-process peak RSS is not simultaneous runner memory or isolated solver memory.

| Dataset | Direct contrast | Common-clean routing, s (n) | Board ratio | Strict raw-constructor HD, s (n) | Strict HD ratio | Same loaded-SRJ HD, s (n) | Source-SRJ HD ratio |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| srj18 | control → old-full | 1,188.6 → 1,228.9 (16) | 0.967× | 389.6 → 406.8 (16) | 0.958× | 389.6 → 406.8 (16) | 0.958× |
| srj24 | control → old-full | 1,007.3 → 995.6 (17) | 1.012× | 727.7 → 759.0 (21) | 0.959× | 727.7 → 759.0 (21) | 0.959× |
| srj18 | control → compression-only | 1,005.9 → 973.9 (15) | 1.033× | 389.6 → 391.3 (16) | 0.996× | 389.6 → 391.3 (16) | 0.996× |
| srj24 | control → compression-only | 1,007.3 → 970.3 (17) | 1.038× | 727.7 → 726.9 (21) | 1.001× | 727.7 → 726.9 (21) | 1.001× |
| srj18 | control → selective | 1,188.6 → 1,302.4 (16) | 0.913× | 389.6 → 404.1 (16) | 0.964× | 389.6 → 404.1 (16) | 0.964× |
| srj24 | control → selective | 1,007.3 → 991.8 (17) | 1.016× | 727.7 → 747.6 (21) | 0.973× | 727.7 → 747.6 (21) | 0.973× |
| srj18 | old-full → selective | 1,228.9 → 1,302.4 (16) | 0.944× | 406.8 → 404.1 (16) | 1.007× | 406.8 → 404.1 (16) | 1.007× |
| srj24 | old-full → selective | 1,215.8 → 1,230.3 (18) | 0.988× | 759.0 → 747.6 (21) | 1.015× | 759.0 → 747.6 (21) | 1.015× |
| srj18 | compression-only → selective | 973.9 → 1,113.7 (15) | 0.874× | 391.3 → 404.1 (16) | 0.968× | 391.3 → 404.1 (16) | 0.968× |
| srj24 | compression-only → selective | 1,133.1 → 1,230.3 (18) | 0.921× | 726.9 → 747.6 (21) | 0.972× | 726.9 → 747.6 (21) | 0.972× |
| srj18 | old-full → compression-only | 973.8 → 973.9 (15) | 1.000× | 406.8 → 391.3 (16) | 1.040× | 406.8 → 391.3 (16) | 1.040× |
| srj24 | old-full → compression-only | 1,215.8 → 1,133.1 (18) | 1.073× | 759.0 → 726.9 (21) | 1.044× | 759.0 → 726.9 (21) | 1.044× |
| srj18 | control → refined-full | 1,188.6 → 1,196.5 (16) | 0.993× | 389.6 → 398.6 (16) | 0.978× | 389.6 → 398.6 (16) | 0.978× |
| srj24 | control → refined-full | 1,007.3 → 998.9 (17) | 1.008× | 727.7 → 760.7 (21) | 0.957× | 727.7 → 760.7 (21) | 0.957× |
| srj18 | old-full → refined-full | 1,228.9 → 1,196.5 (16) | 1.027× | 406.8 → 398.6 (16) | 1.021× | 406.8 → 398.6 (16) | 1.021× |
| srj24 | old-full → refined-full | 1,215.8 → 1,171.2 (18) | 1.038× | 759.0 → 760.7 (21) | 0.998× | 759.0 → 760.7 (21) | 0.998× |
| srj18 | refined-full → selective | 1,196.5 → 1,302.4 (16) | 0.919× | 398.6 → 404.1 (16) | 0.986× | 398.6 → 404.1 (16) | 0.986× |
| srj24 | refined-full → selective | 1,171.2 → 1,230.3 (18) | 0.952× | 760.7 → 747.6 (21) | 1.018× | 760.7 → 747.6 (21) | 1.018× |
| srj18 | compression-only → refined-full | 973.9 → 1,008.3 (15) | 0.966× | 391.3 → 398.6 (16) | 0.982× | 391.3 → 398.6 (16) | 0.982× |
| srj24 | compression-only → refined-full | 1,133.1 → 1,171.2 (18) | 0.968× | 726.9 → 760.7 (21) | 0.956× | 726.9 → 760.7 (21) | 0.956× |

**The two HD columns answer different questions.** Strict raw-constructor timing requires identical original serialized constructor hashes. Same loaded-SRJ timing requires identical pre-solve source board hashes, but constructor fields or declared physical clearance rules may differ. It is not configuration-equivalent evidence. Scenario hashes are recorded separately and never replace SRJ equality. No fields or hashes were normalized to create a cohort.

Both HD timing cohorts require completion on both sides. A partial timeout clock is censored and excluded; recovered or lost completions are listed separately. Common-clean routing excludes changed clean outcomes, so it cannot replace the fixed-corpus score. Ratios above 1 favor the after arm.

| Dataset | Contrast | New clean boards | Lost clean boards | New/lost completed HD, strict raw | New/lost completed HD, same SRJ |
| --- | --- | --- | --- | --- | --- |
| srj18 | baseline-vs-old-full | none | none | none / none | none / none |
| srj24 | baseline-vs-old-full | srj24-002, srj24-011 | none | none / none | none / none |
| srj18 | baseline-vs-compression | none | srj18-015 | none / none | none / none |
| srj24 | baseline-vs-compression | srj24-002 | none | none / none | none / none |
| srj18 | baseline-vs-selective | none | none | none / none | none / none |
| srj24 | baseline-vs-selective | srj24-002 | none | none / none | none / none |
| srj18 | old-full-vs-selective | none | none | none / none | none / none |
| srj24 | old-full-vs-selective | none | srj24-011 | none / none | none / none |
| srj18 | compression-vs-selective | srj18-015 | none | none / none | none / none |
| srj24 | compression-vs-selective | none | none | none / none | none / none |
| srj18 | old-full-vs-compression | none | srj18-015 | none / none | none / none |
| srj24 | old-full-vs-compression | none | srj24-011 | none / none | none / none |
| srj18 | baseline-vs-refined-full | none | none | none / none | none / none |
| srj24 | baseline-vs-refined-full | srj24-002 | none | none / none | none / none |
| srj18 | old-full-vs-refined-full | none | none | none / none | none / none |
| srj24 | old-full-vs-refined-full | none | srj24-011 | none / none | none / none |
| srj18 | refined-full-vs-selective | none | none | none / none | none / none |
| srj24 | refined-full-vs-selective | none | none | none / none | none / none |
| srj18 | compression-vs-refined-full | srj18-015 | none | none / none | none / none |
| srj24 | compression-vs-refined-full | none | none | none / none | none / none |

| Dataset | Contrast | Common-clean vias, totals (n) | Finite common-clean wire, mm (n) | Output hashes, equal / known paired-solved | Strict HD iterations, equal / known |
| --- | --- | ---: | ---: | ---: | ---: |
| srj18 | baseline-vs-old-full | 3,397.0 → 3,413.0 (16/16) | 30,294.3 → 30,310.6 (13/16) | 3/16 | 16/16 |
| srj24 | baseline-vs-old-full | 2,740.0 → 2,741.0 (17/17) | 30,431.1 → 30,455.3 (17/17) | 7/19 | 21/21 |
| srj18 | baseline-vs-compression | 3,055.0 → 3,155.0 (15/15) | 28,048.4 → 28,151.7 (12/15) | 3/16 | 16/16 |
| srj24 | baseline-vs-compression | 2,740.0 → 2,758.0 (17/17) | 30,431.1 → 30,457.9 (17/17) | 6/19 | 21/21 |
| srj18 | baseline-vs-selective | 3,397.0 → 3,374.0 (16/16) | 30,294.3 → 30,269.9 (13/16) | 3/16 | 16/16 |
| srj24 | baseline-vs-selective | 2,740.0 → 2,745.0 (17/17) | 30,431.1 → 30,437.8 (17/17) | 6/19 | 21/21 |
| srj18 | old-full-vs-selective | 3,413.0 → 3,374.0 (16/16) | 30,310.6 → 30,269.9 (13/16) | 7/16 | 16/16 |
| srj24 | old-full-vs-selective | 3,027.0 → 3,087.0 (18/18) | 32,453.2 → 32,525.0 (18/18) | 9/19 | 21/21 |
| srj18 | compression-vs-selective | 3,155.0 → 3,050.0 (15/15) | 28,151.7 → 28,027.0 (12/15) | 4/16 | 16/16 |
| srj24 | compression-vs-selective | 3,045.0 → 3,087.0 (18/18) | 32,501.5 → 32,525.0 (18/18) | 9/19 | 21/21 |
| srj18 | old-full-vs-compression | 3,104.0 → 3,155.0 (15/15) | 28,099.5 → 28,151.7 (12/15) | 4/16 | 16/16 |
| srj24 | old-full-vs-compression | 3,027.0 → 3,045.0 (18/18) | 32,453.2 → 32,501.5 (18/18) | 8/19 | 21/21 |
| srj18 | baseline-vs-refined-full | 3,397.0 → 3,375.0 (16/16) | 30,294.3 → 30,261.4 (13/16) | 3/16 | 16/16 |
| srj24 | baseline-vs-refined-full | 2,740.0 → 2,746.0 (17/17) | 30,431.1 → 30,427.6 (17/17) | 6/19 | 21/21 |
| srj18 | old-full-vs-refined-full | 3,413.0 → 3,375.0 (16/16) | 30,310.6 → 30,261.4 (13/16) | 7/16 | 16/16 |
| srj24 | old-full-vs-refined-full | 3,027.0 → 3,036.0 (18/18) | 32,453.2 → 32,514.8 (18/18) | 10/19 | 21/21 |
| srj18 | refined-full-vs-selective | 3,375.0 → 3,374.0 (16/16) | 30,261.4 → 30,269.9 (13/16) | 10/16 | 16/16 |
| srj24 | refined-full-vs-selective | 3,036.0 → 3,087.0 (18/18) | 32,514.8 → 32,525.0 (18/18) | 14/19 | 21/21 |
| srj18 | compression-vs-refined-full | 3,155.0 → 3,051.0 (15/15) | 28,151.7 → 28,023.8 (12/15) | 4/16 | 16/16 |
| srj24 | compression-vs-refined-full | 3,045.0 → 3,036.0 (18/18) | 32,501.5 → 32,514.8 (18/18) | 9/19 | 21/21 |

Quality comparisons use finite values on both sides of the same common-clean cohort; missing wire lengths are never zero-filled. Output/iteration parity reports explicit known coverage and board IDs in the accompanying JSON/CSV. Exact final pipeline iteration counts are not emitted by this observer and remain unavailable. HD iterations are reported only within their stated completed cohort.

Raw constructor field/rule declarations and original SRJ rule declarations remain in every paired record. DRC counts/types/messages are retained when emitted; an unmeasured or censored DRC result is unknown, not zero. Diagnostic counter comparisons retain matched/missing coverage separately from all-observed totals. Intermediate proposal-conflict counts are not final-board DRC-error counts.

Artifacts: [per-arm summaries](arms.csv), [compact all-arm sample metrics](arm-samples-compact.csv), [direct contrast summaries](contrasts.csv), [verification](report-verification.json), and [all eleven original report files, including every paired/counter/phase/JSON table](ARCHIVE.md).

Original run: https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40740148169 (attempt 1).
