Final PR3328 source CI audit: all ordinary workflows and all nine Bun shards completed.

Published source `365b38451f01c734d3f60628dbd6db14760ca4e6` (local equivalent `372baa96e1078827cb5d7860f85c24875338d0e4`, tree `7718a9ca2f2f3802147fba63560e870de534a665`) was tested as GitHub merge `9d6c1452aad1e434d923620220026c92e440ac1b` into base `9e751e3c7650a1f21f52bad9160650d6aa388a14`. The standalone pinned-baseline benchmark is a separate comparison.

Typecheck, build, packed runtime consumers, Vercel build, dependency checks, string-ID checks, automatic Testbox, and Vercel deployment status succeeded. Format Check failed with 38 diagnostics; no formatting or linting was run locally.

Bun finished with three successful and six failing shards: eight unique failing tests, consisting of one numerical failure and seven SVG differences. Every failure is listed below.

| Test | First failing location | Result |
| --- | --- | --- |
| routes the full MIDI keyboard with preloaded USB traces | `tests/bugs/usb-dp-phase-detour.test.ts:39:51` | SVG: 3.077% versus 1.0% threshold |
| repairs T113 HDMI 1.8 V same-net drill spacing | `tests/repro/pipeline9-t113-hdmi-ddc-via-spacing.test.ts:188:5` | SVG: 40.222% versus 2.0% threshold |
| bugreport88-9a86ed.json with Pipeline 9 | `tests/bugs/bugreport88-9a86ed.test.ts:46:46` | SVG: 29.725% versus 1.0% threshold |
| bugreport94-56fa2e.json with Pipeline 9 | `tests/bugs/bugreport94-56fa2e.test.ts:46:46` | SVG: 42.846% versus 1.0% threshold |
| Pipeline9 routes the exact real A64 byte-zero input without drilling foreign pads | `tests/repro/pipeline9-a64-real-byte0-foreign-pad.test.ts:76:51` | SVG: 3.044% versus 0.0% threshold |
| Pipeline9 repairs SRJ18 sample 3 at 2x effort | `tests/features/pipeline9-srj18-sample3-repair.test.ts:49:49` | SVG: 8.837% versus 1.0% threshold |
| bugreport107-board-1726.json with Pipeline 9 | `tests/bugs/bugreport107-board-1726.test.ts:41:18` | Numerical: expected 0 DRC errors, received 92 |
| bugreport109: Pipeline 9 routes the full reading lamp circuit | `tests/bugs/bugreport109-book-reading-clip-lamp.test.ts:48:5` | SVG: 63.779% versus 1.0% threshold |

Compared with source `83a593a`, the eight failing test names are unchanged. Full MIDI moved from a numerical clearance failure to a final SVG difference: its five preceding original numerical/preload assertions, including reference DRC requiring zero errors, now pass. Bug107 remains a numerical blocker (92 errors versus 89 in the prior CI); a regression-free claim is not supported.

All twelve final focused tests have explicit passing records in the original CI logs, including full-reference via repair, protected endpoints/preloads, distinct-net and foreign-pad rejection, ambiguous preload-ID ownership, and sequential child-stage/failure propagation. The shared branch-weld regression, joint physical projection, inset continuity, full USB shield test, and dataset18 sample01 with four native Bun workers also have explicit whole-test passing records.

An earlier failing SVG can mask later assertions. The A64 test fails at its early SVG, so this audit does not claim its later numerical checks passed. MIDI and T113 reach their final SVG after their preceding numerical checks. A failed SVG remains a whole-test failure.

[Machine-readable audit](legalization-final.json) includes every job, source checkout provenance, first failing location, comparison scope, and original log SHA-256. [Manifest](legalization-final-MANIFEST.json) authenticates the sixteen complete original job logs fetched through the GitHub connector. No workflow was rerun and no local solver test was run for this CI audit.
