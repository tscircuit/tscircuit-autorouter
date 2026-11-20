# Same-layer source turns: final ten-circuit results

The existing analytic fanout generator was missing legal same-layer paths through mixed-size pad arrays. [Fix #333](https://github.com/tscircuit/fanout-solver/pull/333), stacked on [repro #332](https://github.com/tscircuit/fanout-solver/pull/332), improves diagnostic partial fanout in the supplied circuits. **Full-board completion remains 0/10; no additional complete board nets or committed PCB traces are claimed.**

## Measured results

| Supplied circuit | Partial escapes before | After | Vias before | After |
| --- | ---: | ---: | ---: | ---: |
| ButterStick original | 60/91 | 62/91 | 57 | 42 |
| ButterStick spaced | 70/91 | 78/91 | 52 | 41 |
| Glider original | 69/95 | 83/95 | 56 | 56 |
| Glider spaced | Not reached | Not reached | — | — |
| H616 original | 101/174 | 105/174 | 76 | 66 |
| H616 spaced | 96/174 | 111/174 | 61 | 72 |
| iCE/Pi original | 9/32 | 14/32 | 8 | 6 |
| iCE/Pi spaced | 76/92 | 77/92 | 37 | 37 |
| i.MX6 original | 9/32 | 9/32 | 7 | 7 |
| i.MX6 spaced | 7/32 | 7/32 | 1 | 4 |
| **Nine inputs reaching fanout** | **497/813** | **546/813** | **355** | **331** |

Partial escapes increase by **49 (+9.9% relative, 61.1% → 67.2%)**; native vias decrease by **24 (−6.8%)**. Here a partial escape is one pad-to-boundary branch or plane drop in the best diagnostic attempt, not a completed board net. Physical via-site counts equal native via counts in these captures.

There are tradeoffs: spaced H616 gains 15 escapes with 11 additional vias; spaced i.MX6 gains no escapes and uses three additional vias. These are not uniform per-board improvements. Original iCE/Pi improves from 9 to 14 escapes (+55.6%) while reducing vias from eight to six (−25%).

Both runs use the same 600-second routing budget, 660-second process limit and 256-assignment ceiling. ButterStick original, Glider original and both H616 variants are budget-limited after the fix; their counts describe bounded-run observations, not a speed benchmark or an exhaustive maximum. The baseline ButterStick spaced count comes from the partial state captured at the original 600-second budget, not the separate 900-second extension.

## What changed

For actual iCE/Pi U22.B5, the ordinary generator first travels straight toward A5 and leaves only **0.029 mm** copper clearance where **0.1 mm** is required. The validator correctly rejects that segment. The track generator also sizes gaps using the largest pad in the component, omitting a usable gap between narrower perimeter pads.

After ordinary candidates fail, the existing analytic search can start at the source pad and consider midpoint tracks between adjacent pad rows or columns. Actual B5 at (2.49, 11.83) mm can turn through (2.24, 11.58) to (2.24, 10.48) on top, with **0.105 mm** limiting clearance and no via. The same unchanged validator checks it.

The fallback only applies to same-layer analytic routing without explicit source paths, hard reservations or coordinated corner/winding guidance. Ordinary routes retain priority. Its clearance-cache key distinguishes the two geometries. Only two production modules change; there is no new solver, clearance exception, sample-specific rule or assignment-limit increase.

The six-pad repro uses actual U22 A4:A6/B4:B6 geometry. Its native SVG changes from 0/1 to 1/1 escapes, with zero vias. The existing full U22 fixture also updates naturally from 9/32 to 14/32. [Focused and full U22 before/after images are in the fix PR](https://github.com/tscircuit/fanout-solver/pull/333).

## What still fails in the pipeline

Read-only interception records winding placement, fanout constructor inputs, native candidate rejection predicates and subsequent routing phases. The intended sequence remains **fanout → DDR bus lanes → remaining routing**.

- Winding still fails six of 82 placement calls: ButterStick spaced U4, Glider spaced U1/U12, iCE/Pi spaced U1 and both i.MX6 variants' U7. The reported declared-edge capacity shortages are unchanged.
- Glider spaced never invokes fanout. Core proceeds into bus-lane routing after winding placement errors and exhausts the budget. This is an unsuccessful handoff, not successful fanout-first execution.
- The other nine captures remain incomplete at fanout. No remaining-net Pipeline 9 solve starts. After snapshots emit no routed traces or vias; 19 originally connected nets come from retained copper pours.
- Original iCE/Pi's 32 requests comprise 20 plane drops and 12 signal escapes. The improvement is six plane drops plus three signals → six plane drops plus eight signals.
- Some remaining geometry is intrinsically blocked under the captured rules. For example, i.MX6 U10.B2 is enclosed by eight foreign 0.25 mm pads on a 0.5 mm grid under 0.119 mm trace/clearance and 0.4 mm via constraints. This is about the modeled constraints, not universal unroutability of the physical hardware.

The earlier observation that provisional exits overlap foreign pours does not prove a mandatory-layer failure. These singleton targets have `hasExplicitLayeredExitTarget: false`; fanout can replace their positions and layers. The attempted Core layer-filtering change did not improve the real iCE/Pi input and regressed a routed BGA control from 16 to 12 escapes, so it was rejected. Enabling same-net merging also produced drills overlapping real SMD pads and was rejected.

## Validation and reproducibility

The independent [final physical audit](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44805604629) verifies:

- Exact before/after equality of all nine actual fanout constructor inputs; neither run invokes fanout for Glider spaced.
- Native copper DRC passes for every before/after partial.
- Zero independent via-in-pad findings against actual full-circuit SMD pads.
- Unchanged after-run component/pad counts and net membership. Final completed snapshots contain no new routed traces or vias. The baseline ButterStick spaced physical audit uses the saved unrouted circuit because its first process timed out before finalization.

The fix's [eight macOS test shards](https://github.com/tscircuit/fanout-solver/actions/runs/44803607495) pass. Paired macOS native controls retain 61/61 escapes across five distinct six-layer samples while reducing vias from 50 to 38 (−24%). Sample022 adds 0.187 mm of wire for one fewer via; wire length does not decrease in every case. The large guided control remains 25/25 with 35 vias and a byte-identical SVG; preexisting unknown-connection observations from its supplied DDR traces are unchanged. The paired audits are [guided/first controls](https://github.com/tscircuit/fanout-solver/actions/runs/44798001496) and [remaining controls](https://github.com/tscircuit/fanout-solver/actions/runs/44800060526).

Core stays at `351e73d665fad37577c47fcbff2e4c29eb377467` (0.0.2434), fanout 0.0.93 plus only the two source modules from `d84297fba9800657add8f53ff661343f55afd5f5`, bus lanes 0.0.62 and winding `202dbe9eb0088633b6fa094120dba6f2f41f8803`. Final fix head `b7e26e34d99150ecbc8a47c541f738415ad18e4f` has identical production code and adds verified expected outputs. No Core patch is installed. Source checks in the final cohort pass typecheck, format check and the focused repro.

Archive SHA-256: `1991ad1891a953dcd660818aaceb73f7aa42dbf704e677e635753b9159f7a6b7`. Original routes and vias were stripped; circuit geometry, membership, widths, clearances and via policies were retained. Original/spaced variants differ in pours and handoff representation as well as peripheral placement, so the table compares each fixture against itself.

Evidence: [baseline ten-circuit run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44778112884), [final ten-circuit run and source checks](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44798452309), [machine-readable final statistics](source-turn-final-statistics.json), and [baseline interception report and PCB SVGs](analysis.md).
