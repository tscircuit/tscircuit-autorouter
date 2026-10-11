# Supplemental SRJ18 board quality audit

Frozen prototype `dc387aa1f5b4c3c9edeae8194f04b4df28c640b1` was paired with baseline `65522c89c370d4b4f9f69e1a79af58de641752bc` on all16 pinned SRJ18 samples. The source screening runs use one repetition, four-core process affinity, `first-valid` high-density routing, and `goal-balls` pathing. They do not establish the final three-repetition performance result.

The original harness omitted the `pcb_board` from DRC. This supplemental audit evaluates every saved solved output with the same relaxed DRC rules and the original physical board included. It also rechecks physical connection coverage and per-type trace lint. No routes were recomputed, raw reports were retained, and measured times were unchanged. Future harness version2 requires board-inclusive DRC for both variants.

All29 solved outputs have zero board-inclusive DRC errors; every per-type DRC count is therefore zero. The three failed candidate outcomes remain failures with no routed output to audit. All13 solved candidate boards cover every original required net and pair. Candidate002 has1005 odd-angle issues versus931 for the baseline, so it fails the lint gate. Baseline009 and011 omit one physically required net each; their candidate outputs restore those connections.

| Sample | Baseline board DRC | Candidate board DRC | Baseline coverage | Candidate coverage | Baseline odd angles | Candidate odd angles | Accepted |
| --- | ---: | ---: | --- | --- | ---: | ---: | --- |
| [sample001](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/38115780405) | 0 | 0 | 53/53 | 53/53 | 193 | 192 | True |
| [sample002](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/38115780405) | 0 | 0 | 112/112 | 112/112 | 931 | 1005 | False |
| [sample003](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/38115780405) | 0 | 0 | 49/49 | 49/49 | 275 | 18 | True |
| [sample004](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/38115780405) | 0 | 0 | 45/45 | 45/45 | 848 | 462 | True |
| [sample005](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/38115781916) | 0 | 0 | 62/62 | 62/62 | 29 | 11 | True |
| [sample006](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/38115781916) | 0 | 0 | 66/66 | 66/66 | 932 | 615 | True |
| [sample007](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/38115781916) | 0 | 0 | 61/61 | 61/61 | 123 | 13 | True |
| [sample008](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/38115781916) | 0 | 0 | 77/77 | 77/77 | 963 | 860 | True |
| [sample009](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/38115783406) | 0 | 0 | 71/72 | 72/72 | 269 | 260 | True |
| [sample010](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/38115783406) | 0 | 0 | 59/59 | 59/59 | 177 | 23 | True |
| [sample011](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/38115783406) | 0 | 0 | 73/74 | 74/74 | 519 | 108 | True |
| [sample012](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/38115783406) | 0 | 0 | 97/97 | 97/97 | 897 | 135 | True |
| [sample013](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/38115783406) | 0 | failed | 52/52 | failed | 592 | failed | False |
| [sample014](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/38115785004) | 0 | failed | 56/56 | failed | 709 | failed | False |
| [sample015](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/38115786618) | 0 | failed | 103/103 | failed | 1213 | failed | False |
| [sample016](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/38115783406) | 0 | 0 | 59/59 | 59/59 | 389 | 295 | True |

Candidate failures:013 rejects a noncolocated layer transition during physical simplification;014 rejects duplicate original terminal identity during stitching;015 rejects unreachable route fragments during stitching. These are reported outcomes, not excluded samples.

All29 rechecked outputs reproduce the original omitted-board DRC count and the original per-type lint counts. [Compact JSON evidence](parallel-srj18-dc387aa1f-board-quality.json) records all32 outcomes, required net/pair counts, trace/via counts, source workflow links, and pinned dataset hashes. Detailed local error and geometry artifacts remain in the downloaded workflow outputs.
