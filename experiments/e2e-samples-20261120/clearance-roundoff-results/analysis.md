# Full-circuit routing investigation, 20 November 2026

The ten uploaded circuits still complete **0/10 boards**. The accepted fix addresses a separate, demonstrated routing bug: legal fixed copper at exactly 0.1 mm clearance can be rejected by floating-point rounding. The captured six-signal handoff changes from **0/6 to 6/6 newly routed connections**, with all six existing fanout traces unchanged and zero relaxed DRC findings. This is a scoped correctness improvement, not a full-cohort completion improvement.

[Repro PR #4015](https://github.com/tscircuit/tscircuit-autorouter/pull/4015) → [fix PR #4016](https://github.com/tscircuit/tscircuit-autorouter/pull/4016). The fix changes one geometric comparison module; it adds no solver, routing fallback, API option, or acceptance of failed fanout output.

The input is the supplied ZIP, SHA-256 `1991ad1891a953dcd660818aaceb73f7aa42dbf704e677e635753b9159f7a6b7`. All ten full circuits retain their component, pad and net membership. There are 3,264 components, 14,826 pads and 2,856 nets with at least two physical ports. Original routed traces and vias are removed; existing copper pours remain. The spaced variants also omit pours, so original versus spaced is not a spacing-only experiment. DDR component placement is preserved.

Routing is configured as fanout → DDR bus lanes → remaining routing. Each solver constructor input, phase transition, failure state and final PCB is captured in the [current ten-board run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44772251019). Each attempt has a 600-second routing budget and a 660-second process limit on Blacksmith 8-vCPU ARM runners.

| Circuit | Requested multiport nets | Best diagnostic fanout escapes | Stopping point | PCB SVGs |
| --- | ---: | ---: | --- | --- |
| butterstick-original | 317 | 60/91 | Fanout assignment failed | [Before](before/butterstick-original/pcb.svg) · [After](after/butterstick-original/pcb.svg) |
| butterstick-spaced | 317 | 70/91 | Fanout assignment failed | [Before](before/butterstick-spaced/pcb.svg) · [After](after/butterstick-spaced/pcb.svg) |
| glider-original | 356 | 69/95 | Fanout budget exhausted | [Before](before/glider-original/pcb.svg) · [After](after/glider-original/pcb.svg) |
| glider-spaced | 356 | Not reached | Placement failed; bus budget exhausted | [Before](before/glider-spaced/pcb.svg) · [After](after/glider-spaced/pcb.svg) |
| h616-original | 121 | 107/174 | Fanout budget exhausted | [Before](before/h616-original/pcb.svg) · [After](after/h616-original/pcb.svg) |
| h616-spaced | 121 | 99/174 | Fanout budget exhausted | [Before](before/h616-spaced/pcb.svg) · [After](after/h616-spaced/pcb.svg) |
| icepi-original | 230 | 9/32 | Fanout assignment failed | [Before](before/icepi-original/pcb.svg) · [After](after/icepi-original/pcb.svg) |
| icepi-spaced | 230 | 76/92 | Fanout assignment failed | [Before](before/icepi-spaced/pcb.svg) · [After](after/icepi-spaced/pcb.svg) |
| imx6-original | 404 | 9/32 | Fanout assignment failed | [Before](before/imx6-original/pcb.svg) · [After](after/imx6-original/pcb.svg) |
| imx6-spaced | 404 | 7/32 | Fanout assignment failed | [Before](before/imx6-spaced/pcb.svg) · [After](after/imx6-spaced/pcb.svg) |

“Diagnostic escapes” counts chip-to-breakout branches in the best partial fanout attempt. A multiport net can require multiple escapes. These branches are never counted as completed board nets or committed as successful fanout output. H616 and Glider original hit the budget while the solver is still searching, rather than proving routing impossible.

No new traces or vias are emitted by these failed full-circuit attempts. The 19 connections reported by the physical audit are already joined by original copper pours: ButterStick original 9, iCE/Pi original 7, i.MX6 original 3. They are not newly routed nets. Zero final copper findings on an unrouted board does not establish routing success.

The pipeline captures locate the main blockers upstream: six attempts exhaust all fanout assignments, three time out during fanout, and Glider spaced times out in bus-lane routing after breakout placement has already failed. Pipeline 9 never starts in these ten attempts, so this numerical fix cannot remove those upstream blockers. Glider spaced also exposes the existing handoff problem: Core permits bus routing after winding placement fails. That is recorded as a failure, not presented as a successful fanout-first route.

The numerical defect is in Pipeline 9’s immutable-copper guard. A legal wire pair has a computed edge gap of `0.09999999999999995` mm against a `0.1` mm minimum. The strict comparison rejects it. A `1e-9` mm tolerance absorbs that rounding error in wire/wire, wire/via, via/wire and via/via comparisons. All four combinations also have a control moved `0.0001` mm too close; every real violation remains rejected.

| Captured fixed-fanout handoff | Before | After |
| --- | ---: | ---: |
| Newly routed connections | 0/6 | 6/6 |
| Input fanout traces preserved | 6/6 | 6/6 |
| Completed-result relaxed DRC findings | Not solved | 0 |

The six-signal success assertions check immutable input, exact preservation of the original six traces, all six routed connection names and physical DRC. Twelve focused tests, type checking and formatting pass on the repository’s Ubuntu 24.04 / Bun 1.4.3 configuration: [validation run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44774785868).

Additional paired replays of existing A13, H616 and i.MX6 controls produce byte-identical before/after SVGs, with identical vias and audit findings: [comparison run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44773959721), [measurements and SVG hashes](existing-board-comparison.json). Those replays used Bun 1.4.2; their differences from stored snapshots are not attributed to this fix, and those snapshots are not changed. H616’s control renders accepted high-density stage fragments, so its audit is not a certificate for a completed full board.

The broader Core fanout-preservation change is held back. It improves the small six-signal board, but an existing 16-signal controller produces genuine foreign-copper crossings and a via gap of `0.096802` mm against a `0.1` mm rule. The guard correctly rejects those routes. An earlier obstacle-only representation also introduced a real via/trace violation. Neither change is included in the fix PR. Likewise, a shared layer allocator recovered five placement calls but completed no additional full boards; that change is not proposed as a routing improvement.

Core is pinned to `351e73d` (0.0.2434), fanout 0.0.93, bus lanes 0.0.62 and winding source `202dbe9`. The isolated numerical candidate is `f9c08dc`; the final PR’s formatting-only revision emits identical JavaScript. The PR is based on current router main `7d02b59` (0.0.1136), whose production library tree matches the benchmark base `2b1207ad`.

The historical full-cohort baseline and current run have different Core lockfile hashes, although all recorded package versions match. Both hashes and this limitation remain in [summary.json](summary.json). These are independent completion observations, not a matched performance experiment; no latency or causal performance percentage is claimed. The **100%** figure applies only to six of six routed connections in the captured handoff. Full-cohort completion remains 0/10 in both observed runs.
