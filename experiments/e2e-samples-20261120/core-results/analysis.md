# Uploaded full-circuit routing: 20 November 2026

Selected fix: stop routing when automatic fanout placement has left unresolved handoffs. The 11-line core change prevents routing from continuing on the original unsplit endpoints in **5/10 circuits**. Whole-board completion remains **0/10 → 0/10**.

Median wall time to return a failure or routing-budget result falls **424.4s → 190.5s (55.1% lower)**. These are failed/budgeted run times, including capture overhead. There are no completed boards from which to calculate time-to-solve P50/P95.

## Matched results

| Metric | Before | After | Change |
|---|---|---|---|
| Complete boards | 0/10 | 0/10 | +0 boards |
| Median failed/budgeted wall time | 424.4s | 190.5s | 55.1% lower |
| P95 failed/budgeted wall time | 623.6s | 609.7s | 2.2% lower |
| Total paired-cohort wall time | 4210.9s | 3090.2s | 26.6% lower |
| Circuits entering routing after failed winding placement | 5 | 0 | Prevented in 5 circuits |

A routing invocation below means an observed FanoutSolver, BusLanesPipelineSolver or generic autorouter instance. Placement solvers still run to produce the original diagnostic. Connected nets count physical continuity through emitted copper and actual pours; diagnostic partial fanout attempts do not count. Singleton nets are excluded.

| Circuit | Routing invocations before→after | Seconds before→after | Time reduction | Connected nets before→after / requested | Emitted vias before→after | Copper DRC findings before→after |
|---|---|---|---|---|---|---|
| butterstick-original | 1→1 | 369.3→391.4 | -6.0% | 9→9 / 317 | 0→0 | 0→0 |
| butterstick-spaced | 1→0 | 479.5→195.3 | 59.3% | 0→0 / 317 | 0→0 | 0→0 |
| glider-original | 1→1 | 609.5→608.9 | 0.1% | 0→0 / 356 | 0→0 | 0→0 |
| glider-spaced | 1→0 | 634.1→109.2 | 82.8% | 0→0 / 356 | 0→0 | 0→0 |
| h616-original | 1→1 | 604.3→604.5 | -0.0% | 0→0 / 121 | 0→0 | 0→0 |
| h616-spaced | 1→1 | 610.7→610.4 | 0.1% | 0→0 / 121 | 0→0 | 0→0 |
| icepi-original | 1→1 | 133.8→132.7 | 0.9% | 7→7 / 230 | 0→0 | 0→0 |
| icepi-spaced | 1→0 | 289.5→99.9 | 65.5% | 0→0 / 230 | 0→0 | 0→0 |
| imx6-original | 1→0 | 254.3→185.7 | 27.0% | 3→3 / 404 | 0→0 | 0→0 |
| imx6-spaced | 1→0 | 225.9→152.1 | 32.7% | 0→0 / 404 | 0→0 | 0→0 |

All emitted traces/vias and connected-net details are in each report and assessment. Nets connected while the trace count is zero are connected by freshly generated physical pours. The fix preserves errors from placement and avoids spending the routing budget on a topology missing its required handoffs.

## Pipeline interception and first blockers

Every run captures constructor SRJs, autorouting phase SRJs, stage transitions and parameter summaries, periodic best assignments and active child failure states. Inputs were replayed independently to distinguish missing legal candidates from physical obstruction. Full captures remain in [the benchmark artifacts](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44735325252).

| Circuit | First remaining blocker |
|---|---|
| butterstick-original | Fanout failed for U11: only 60 of 91 connections could escape to the breakout boundary. |
| butterstick-spaced | Winding fanout failed for U4: WindingBreakoutSolver: declared breakout edges need 17.38mm but expose only 17.00mm. |
| glider-original | Fanout search budget exhausted |
| glider-spaced | Winding fanout failed for U1: WindingBreakoutSolver: declared breakout edges need 16.91mm but expose only 16.80mm. |
| h616-original | Fanout search budget exhausted |
| h616-spaced | Fanout search budget exhausted |
| icepi-original | Fanout failed for U22: only 9 of 32 connections could escape to the breakout boundary. |
| icepi-spaced | Winding fanout failed for U1: WindingBreakoutSolver: declared breakout edges need 17.43mm but expose only 14.64mm. |
| imx6-original | Winding fanout failed for U7: WindingBreakoutSolver: declared breakout edges need 16.21mm but expose only 14.50mm. |
| imx6-spaced | Winding fanout failed for U7: WindingBreakoutSolver: declared breakout edges need 16.21mm but expose only 14.50mm. |

The placement error was recorded before async routing started. Its automatic breakout points had no PCB identities, so no fanout handoffs entered the SRJ. Empty fanout phases were skipped, allowing subsequent solvers to work on unsplit connections. Group now checks the unresolved automatic points before starting async routing. Its selector stays inside the routing subcircuit; manual points and already resolved dogbone points continue through the existing path.

The reported edge-capacity failures are failures of the current placement planner under its declared spacing and edge constraints. They are not proofs that those whole boards are physically unroutable. The next investigation should examine edge allocation, layer capacity and wire/via spacing, then the remaining fanout search budgets.

i.MX6 U10 has a separate geometric obstruction: seven requested pads are enclosed by eight foreign pads. At even a 0.12mm wire width and 0.119mm clearance, 0.25mm pads on 0.5mm pitch form a closed centerline exclusion ring (radius 0.304mm). A 0.4mm via requires 0.444mm separation from each foreign pad, confining the interior via center to within 0.084972mm of its source, inside the source pad’s 0.125mm radius. The no-via-in-pad rule prevents that escape. [Measurements](../emmc-geometry-evidence.json).

## Inputs and reproducibility

The ten supplied TSX files replace the previous board set: original and spaced H616, ButterStick, Glider, i.MX6 and iCE/Pi. All DDR, peripheral and power connectivity is included: **2,856 multi-terminal nets**. The archive SHA-256 is `1991ad1891a953dcd660818aaceb73f7aa42dbf704e677e635753b9159f7a6b7`.

Baseline core is `4306536282fe5abf32c1395e106f55a5d61ca7a3`; the candidate Group source is byte-identical to the fix PR and recorded in [core-candidate.json](../core-candidate.json). Autorouter stays `2b1207ad70971f326166b134ea19418137273f23`, fanout stays `9e771f68dca591642fca3b97187e14404c16c5aa`, bus-lanes stays 0.0.62, and Bun is 1.4.3. No source-turn change is included in this comparison.

Each pair runs serially on one Blacksmith 8-vCPU ARM machine with the same installed dependencies, input hashes and rules, a 600-second routing budget and a 660-second process limit. Originals run before→after; spaced variants run after→before. Source fingerprints are checked before each run. Wall time includes identical instrumentation and is not a measure of uninstrumented solver latency. Zero newly emitted input traces/vias is verified; when the guard prevents any routing start, the final zero-copper result is checked instead.

The original supplied helpers default fanout off; the spaced helpers lack standalone fanout support. [correct-workflow.tsx](../correct-workflow.tsx) enables the requested fanout → DDR bus lanes → remaining signals/power sequence. Native geometry, electrical membership and nominal widths are retained. Spaced escape widths come from the paired original’s explicit escape widths. [Input hashes](../inputs.json), [electrical equivalence](../electrical-equivalence.json), [geometry checks](../workflow-geometry-check.json).

Spaced variants also omit original copper pours and split the remaining phases, so original-versus-spaced differences cannot be attributed only to peripheral spacing. Original pour intent is retained; no pours are invented for spaced boards. The unchanged-default control cohort and its later bus/peripheral failures are recorded in [the preceding analysis](https://github.com/tscircuit/tscircuit-autorouter/blob/analysis/e2e-results-20261120/experiments/e2e-samples-20261120/results/analysis.md#unchanged-default-controls).

## Fix and experiment decision

[Repro #5742](https://github.com/tscircuit/core/pull/5742) records the natural SVG before the guard. [Stacked fix #5743](https://github.com/tscircuit/core/pull/5743) updates that same SVG. The shallow case shows four actual bus routes bypassing an infeasible fanout before the fix, then preserves the original diagnostic and stops that bypass after the fix. The fix adds 11 production lines in one existing file.

A source-turn/midpoint candidate was also measured and rejected: it improves the focused U22 diagnostic from 9/32 to 14/32 with fewer vias, but full-board completion stays 0/10, median failed/budgeted time rises 12.8%, Glider loses one diagnostic escape under the budget, and i.MX6 spaced adds two vias for one extra escape. Its two draft PRs were closed. [All ten measurements and SVGs for that rejected candidate](https://github.com/tscircuit/tscircuit-autorouter/blob/analysis/e2e-results-20261120/experiments/e2e-samples-20261120/results/analysis.md).

## Actual PCB SVGs

These are emitted PCB results, including incomplete boards. Failed fanout diagnostic copper is uncommitted and therefore absent from these PCBs. Board completion remains reported separately above.

| Circuit | Before PCB | After PCB |
|---|---|---|
| butterstick-original | [SVG](before/butterstick-original/pcb.svg) | [SVG](after/butterstick-original/pcb.svg) |
| butterstick-spaced | [SVG](before/butterstick-spaced/pcb.svg) | [SVG](after/butterstick-spaced/pcb.svg) |
| glider-original | [SVG](before/glider-original/pcb.svg) | [SVG](after/glider-original/pcb.svg) |
| glider-spaced | [SVG](before/glider-spaced/pcb.svg) | [SVG](after/glider-spaced/pcb.svg) |
| h616-original | [SVG](before/h616-original/pcb.svg) | [SVG](after/h616-original/pcb.svg) |
| h616-spaced | [SVG](before/h616-spaced/pcb.svg) | [SVG](after/h616-spaced/pcb.svg) |
| icepi-original | [SVG](before/icepi-original/pcb.svg) | [SVG](after/icepi-original/pcb.svg) |
| icepi-spaced | [SVG](before/icepi-spaced/pcb.svg) | [SVG](after/icepi-spaced/pcb.svg) |
| imx6-original | [SVG](before/imx6-original/pcb.svg) | [SVG](after/imx6-original/pcb.svg) |
| imx6-spaced | [SVG](before/imx6-spaced/pcb.svg) | [SVG](after/imx6-spaced/pcb.svg) |
