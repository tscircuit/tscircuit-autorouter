# Bug107 initial-HD physical geometry ablations

These correctness-only ablations use immutable conservative source `2f77750b`, one early-stopped initial-HD capture, and exact per-region substitutions. They do not rerun downstream repair or predict a final clean board.

| Legalizer body / ablation | Relaxed physical errors | Declared physical errors | Cross-region relaxed |
|---|---:|---:|---:|
| old-full | 1164 | 1198 | 322 |
| prior | 1398 | 1427 | 411 |
| strict | 1392 | 1421 | 410 |
| actual | 1202 | 1230 | 332 |
| expanded | 1202 | 1230 | 332 |
| freeze-outside | 1198 | 1226 | 328 |
| freeze-vias | 1253 | 1279 | 405 |
| freeze-all | 1302 | 1326 | 414 |

The actual 47 proposal outputs reproduce byte-for-byte after connMap and undefined-property restoration. Every output maps exactly into 507 of the captured 6,726 HD routes, preserving all other output metadata except the expected parent root-name restoration. The actual recombination exactly recovers the original initial-HD JSON.

The continuous bounds change reduces physical errors compared with the same joint projection under strict bounds (1,202 versus 1,392), including cross-region errors (332 versus 410). Original old-full body remains lower at 1,164. Both new and removed participant-group conflicts exist; the aggregate reduction does not establish a no-regression guarantee.

The obstacle-filter explanation was falsified: extending the filter gives identical geometry for all 47 proposals, and an independent all-obstacle audit finds zero new or worsened route-obstacle penetration. Real interior points extend 0.0046875–0.025 mm beyond some node bounds, but none produce the hypothesized omitted-obstacle violation.

Freezing off-inset vias or all off-inset vertices worsens aggregate copper errors. Freezing only outside-node vertices removes four errors, which does not justify a new whole-board claim. No explicit same-net via pair lies a nonzero distance at most 1e-9 mm apart in these 47 inputs, so the known synthetic near-alias defect is not supported as this case’s cause.

**The unchanged full Bug107 test still fails with 92 relaxed DRC errors.** Its joint output has 94 relaxed/104 declared errors; later processing introduces none of the final errors and removes two. These offline HD improvements do not resolve that regression.

All checks above examine physical copper/drill/board constraints with continuity disabled because the HD segments have not yet been stitched. Historical body substitutions use the current captured parameters, not historical complete factory or pipeline execution. No timing comparison is valid.

Detailed results: `OFFLINE_CAUSAL_FINDINGS.json`, `PARTICIPANT_GROUP_CONTRASTS.json`, `recombination-mapping.json`, the per-variant summaries, and independent `OBSTACLE_FILTER_AUDIT.json`.
