# Joint legalization: current regression evidence

Published head `83a593a901b1209a024ab3a96bb9c191871b8df4` uses runtime local source `6eb1871908f7a717610c005d551230e94c5936cf`. Automatic CI tests merge `18205535eab35f2da76f37c461884f75b9ded93a` into base `9e751e3c7650a1f21f52bad9160650d6aa388a14`; exact-source benchmark and local QA are separate scopes.

## Completed CI

All nine Bun shards finished. There are eight unique failures: six SVG expectations and two numerical assertions. Type Check, Build/packed consumers, Vercel, ID/dependency checks and the automatic Testbox benchmark pass. Format Check reports 31 diagnostics; no formatting was performed. Exact logs, source identities and failure-name/kind comparisons are in `ci-audits/legalization-round2.json`.

- MIDI `usb-dp-phase-detour.test.ts:36`: one same-net via-clearance error between `via_89` and `via_97`, gap `-0.19447727465848702 mm`, minimum `0.1 mm`. Traces are `source_net_37_mst1_0` and `source_net_37_mst3_0`; their centers are only `0.005522725 mm` apart. The unchanged standalone `6eb18719` test reproduces this exactly, so this specific failure is not caused solely by the CI merge context. Final capture lives in `legalization-joint-midi-capture`.
- Bug107 `bugreport107-board-1726.test.ts:41`: relaxed-DRC zero-length assertion receives 89 errors. CI logs expose only the count, not their types. The later declared-DRC JSON-writing branch is not reached. Do not characterize the 89 errors as connectivity or clearance without a captured result.

MIDI newly fails compared with the first refinement `70d7`; Bug107 changes from an SVG failure to an earlier numerical failure. Against historical full source `8115`, both names were already failing SVG expectations, so these are assertion-kind regressions, not newly appearing names.

Actual positive CI executions include the original native-worker sample01 test, original two-phase USB-shield test, and all three new focused regressions. A file listed by the test-plan generator is not itself evidence that the test executed.

## Actual cmn_3 gain remains valid

Production point-graph validation passes for original, old-full and current joint output: 58 connection groups and 160 ports remain connected. Independent geometry auditing also preserves all 80 explicit node-port pairs and all 504 originally connected same-net port pairs, both for centerline contact and physical copper capsules. There are no unmapped ports, lost pairs or changed 65-component partition. See `node-geometry-diagnostic/connectivity/copper-connectivity-audit.json`.

Therefore the real-node reduction from 121 to 12 literal overlaps and eight to zero drill pairs is a useful local improvement on this case. It does not erase the new whole-board regressions.

## Independent topology probes

1. `node-geometry-diagnostic/branch-weld-probe.ts` proves a new owner-annotation compression defect. An initially connected 9-point proposal loses an interior trunk junction shared with another route endpoint. Current joint output is accepted as improved while production point connectivity becomes false and an independent physical copper gap reaches `0.200001 mm`. Prior refined-full output retains the owner-bearing point and stays connected. Parent is testing the simpler remedy of restoring conservative metadata compression instead of introducing a broad contact graph rewrite.
2. `node-geometry-diagnostic/near-alias-via-probe.ts` proves a latent alias-identity defect in both prior refined-full and current joint code. Same-net vias initially `1e-12 mm` apart become `0.355375976 mm` apart, disconnecting the port graph while reported drill-pair counts remain zero. Within-proposal owner canonicalization already uses the first same-net route index; the remaining defect is exact-coordinate identity and possibly cross-node identity. This probe does not establish the MIDI phase of introduction.

## Node-interface variants

All are isolated correctness replays, with final guards preserved and no performance claims:

| Variant on captured cmn_3 | Accepted steps | Final overlaps | Final hole pairs |
| --- | ---: | ---: | ---: |
| Current joint plus baseline-inclusive bounds | 40 | 12 | 0 |
| Restore original strict inset only | 0 | 121 | 8 |
| Strict inset; fix all initially off-inset vertices | 4 | 107 | 8 |
| Strict inset; fix only initially off-inset physical vias | 13 | 49 | 5 |

These variants demonstrate tradeoffs; none yet proves the cause or remedy of the MIDI whole-board regression. The runtime source remains unchanged while a faithful phase observer identifies where the two near-coincident final vias first diverge.
