The reviewed stack fixes trace-width resolution and candidate reuse (#318), integrates atomic conflict repair into ordinary routing (#305), and makes boundary-point detection independent of copper width (#322). Each fix is one commit above the two repro PRs. The repro SVGs update naturally through the stack.

The original six TSX sources, captured fanout inputs, core, autorouter and dependencies remain frozen. All benchmarks ran on Blacksmith. The full boards route fresh in the order fanout → bus lanes → remaining nets; no board completes fanout, so none reaches bus lanes. Schedule metadata comes from the original verified capture; routes are recomputed.

| Full-board diagnostic requests | Old combined stack, qualified | Reviewed stack, qualified | Reviewed raw requests |
| --- | ---: | ---: | ---: |
| OrangeCrab | 133/273 | 142/273 | 143 |
| Allwinner H616 | 52/174 | 109/174 | 109 |
| ButterStick | 32/91 | 55/91 | 55 |
| Glider | 78/95 | 72/95 | 72 |
| i.MX6 | 19/32 | 19/32 | 19 |
| iCE/Pi | 18/32 | 19/32 | 19 |
| Total | 332/697 | 416/697 (+25.3%) | 417 |

These are individual valid requests in uncommitted partial fanouts from the first failed fanout region in each board, not connected electrical nets or completed boards. Multiple requests can belong to one electrical net. Qualification checks requested width, copper DRC and terminal contact with modeled finite plane copper. Wrong-width requests fall from 67 to zero. One OrangeCrab plane landing remains invalid, with exactly the same violation as before; it is excluded above and causes that board's full audit to fail. Both versions complete zero of six boards and commit zero traces/vias. All six raw PCB SVGs and physical circuit objects are unchanged.

| Staged native diagnostic | iCE/Pi | i.MX6 | Glider | Total | Physical drills |
| --- | ---: | ---: | ---: | ---: | ---: |
| After #318 | 11/32 | 14/32 | 60/95 | 85/159 | 77 |
| After #305 | 19/32 | 19/32 | 75/95 | 113/159 (+32.9%) | 96 |
| After #322 | 19/32 | 19/32 | 72/95 | 110/159 | 91 |

All accepted copper in these three staged captures passes independent DRC, width and modeled plane-contact checks. #305 gains 32 requests and loses four. #322 changes Glider by six gains and nine losses; its benefit is fewer vias, with a joint-routing tradeoff. Plane direction keeps its existing preference semantics; preference changes are recorded separately from physical violations.

For the separate 300-request boundary cohort, #322 accepts the same 276 requests and reduces physical drills from 199 to 181 (9.0%). This is an isolated-request result, not an increase in whole-board completion.

The matched frozen 72-case guard preserves all 30 completed cases. All 30 completed SVG hashes are identical, and every completed case passes physical qualification. Each case has a 120-second limit; concurrency is 16 on the same 32-vCPU worker.

| Frozen guard, completed cases | Old combined stack | Reviewed stack |
| --- | ---: | ---: |
| Completed | 30/72 | 30/72 |
| P50 | 41.995 s | 43.723 s |
| P95 | 97.021 s | 94.901 s |
| Mean | 48.723 s | 49.669 s |
| Mean vias | 148.5 | 148.5 |

Percentiles use nearest rank among completed cases. Timing is mixed; no runtime improvement is claimed. The changes are retained for correct width handling, shared routing architecture and the validated partial-route gains, while preserving completed-case geometry.

[analysis.json](analysis.json) records exact source pins, runs, hash proofs and qualification policy. Raw staged reports are in native-before.json, native-after.json, boundary-300.json.gz and frozen72.json. Each full-boards directory contains audits, source/runtime metadata and a lossless SRJ patch. Use reconstruct-output.py with the corresponding original captured input to restore a diagnostic output; its original compressed-output hash records provenance and is not a claim of byte-identical gzip re-encoding.
