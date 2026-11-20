# Uploaded full-circuit routing: 20 November 2026

Whole-board completion: **0/10 before → 0/10 after**. A complete board must finish rendering, physically connect every multi-terminal net and pass the recorded copper checks. The source-turn change improves legal package escapes; it does not establish a full-board routing improvement.

## Inputs and execution

These ten uploaded TSX circuits replace the older board set. There are 2,856 multi-terminal nets across the ten circuits, including DDR, peripheral signals and power. Every run starts with zero traces and vias. Sources are verified against the uploaded ZIP SHA-256 `1991ad1891a953dcd660818aaceb73f7aa42dbf704e677e635753b9159f7a6b7`.

Pinned revisions: core `4306536282fe5abf32c1395e106f55a5d61ca7a3`, autorouter `2b1207ad70971f326166b134ea19418137273f23`, merged fanout `9e771f68dca591642fca3b97187e14404c16c5aa`, bus-lanes 0.0.62, Bun 1.4.3. Candidate source hashes are in [candidate.json](../candidate.json). The benchmark checks out the final PR commit and verifies every changed library file by SHA-256.

Each matched pair runs serially on one Blacksmith 8-vCPU ARM machine with the same installed dependencies and a 600-second routing budget (660-second hard process limit). Original samples run before→after; spaced samples run after→before. Instrumentation and physical audits are identical on both sides. Wall times include capture overhead and are not uninstrumented solver latency measurements.

The uploaded original helpers disable fanout by default; the spaced helpers do not implement it. The unchanged-default control cohort is recorded separately below. The measured comparison uses [correct-workflow.tsx](../correct-workflow.tsx) to request fanout → DDR bus lanes → remaining signals/power. Native pad placement, net membership, nominal widths and DDR geometry are retained. Spaced escape widths come from the paired original’s explicit escape widths. Hashes and geometry checks are in [inputs.json](../inputs.json), [electrical-equivalence.json](../electrical-equivalence.json) and [workflow-geometry-check.json](../workflow-geometry-check.json).

The spaced files also remove original copper pours and split the remaining routing phases. Differences between original and spaced boards cannot be attributed solely to peripheral spacing. No pours are invented for the spaced files.

## Matched full-circuit results

**Escapes are diagnostic terminal-to-boundary paths, not connected electrical nets.** A terminal may share its electrical net with other terminals. Failed fanout copper is not committed to the PCB. Budgeted rows show the last captured best completed assignment, not a completed search or a transient progress counter.

| Circuit | Before escapes | After escapes | Diagnostic vias before→after | Diagnostic requests gained / lost | Emitted connected nets before→after | Copper DRC findings before→after | Seconds before→after |
|---|---|---|---|---|---|---|---|
| butterstick-original | <board#2868 /> 60/91 | <board#2868 /> 62/91 | 57→55 | 4 / 2 | 9→9/317 | 0→0 | 369.8→403.9 |
| butterstick-spaced | <board#2775 /> 70/91 | <board#2775 /> 74/91 | 52→47 | 9 / 5 | 0→0/317 | 0→0 | 476.9→551.1 |
| glider-original | <board#2829 /> 72/95 | <board#2829 /> 71/95 (budget) | 63→58 | 7 / 8 | 0→0/356 | 0→0 | 598.1→608.4 |
| glider-spaced | Breakout placement failed | Breakout placement failed | — | — | 0→0/356 | 0→0 | 639.5→638.7 |
| h616-original | <board#1410 /> 107/174 (budget) | <board#1410 /> 112/174 (budget) | 88→84 | 11 / 6 | 0→0/121 | 0→0 | 604.2→604.6 |
| h616-spaced | <board#1262 /> 99/174 (budget) | <board#1262 /> 106/174 (budget) | 82→83 | 19 / 12 | 0→0/121 | 0→0 | 611.0→610.7 |
| icepi-original | <board#2619 /> 9/32 | <board#2619 /> 14/32 | 8→6 | 5 / 0 | 7→7/230 | 0→0 | 135.2→145.0 |
| icepi-spaced | <board#2307 /> 76/92 | <board#2307 /> 77/92 | 37→37 | 1 / 0 | 0→0/230 | 0→0 | 284.6→309.8 |
| imx6-original | <board#3446 /> 9/32 | <board#3446 /> 9/32 | 7→7 | 0 / 0 | 3→3/404 | 0→0 | 281.5→300.7 |
| imx6-spaced | <board#3165 /> 7/32 | <board#3165 /> 8/32 | 1→3 | 1 / 0 | 0→0/404 | 0→0 | 225.2→258.6 |

Connected nets with zero emitted traces are connected by freshly generated physical copper pours. They are not newly autorouted nets. Diagnostic copper is separately clearance-checked in each diagnostics.json; zero emitted-copper DRC findings alone do not validate diagnostic routes.

## Where the pipeline stops

| Circuit | First blocker after the fix |
|---|---|
| butterstick-original | Fanout incomplete |
| butterstick-spaced | Fanout incomplete |
| glider-original | Fanout search budget |
| glider-spaced | Winding fanout failed for U1: WindingBreakoutSolver: declared breakout edges need 16.91mm but expose only 16.80mm. |
| h616-original | Fanout search budget |
| h616-spaced | Fanout search budget |
| icepi-original | Fanout incomplete |
| icepi-spaced | Fanout incomplete |
| imx6-original | Fanout incomplete |
| imx6-spaced | Fanout incomplete |

The captures include every FanoutSolver input, each autorouting phase SRJ, solver stage transitions, bounded stage-parameter descriptions, and periodic best attempts/child failure states. The complete replay data remains in [the matched benchmark artifacts](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44732068168). Nine cases encounter fanout failure or budget exhaustion. Glider spaced fails implicit winding-breakout placement before FanoutSolver; it subsequently attempts a DDR phase without the intended escapes. That is a separate pipeline-gating issue, not successful fanout.

i.MX6 U10 has a physical obstruction under the supplied rules. Seven requested pins have a closed ring of neighboring 0.25mm pads on 0.5mm pitch. With a 0.12mm trace and 0.119mm clearance, the centerline exclusion radius is 0.304mm. A 0.4mm via needs 0.444mm separation from each foreign pad; the remaining interior via-center region stays within 0.084972mm of the source, inside its 0.125mm pad radius. It cannot escape without changing those rules or permitting a via in its pad. [Geometry measurements](../emmc-geometry-evidence.json) record both this obstruction and the contrasting legal iCE/Pi corridor.

## Selected fix and rejected experiments

The actionable geometry defect is a legal immediate 45-degree turn between mixed-width pads. The existing source prefix extends too far into the next pad and the candidate list omits the gap midpoint. The fix extends the existing candidate generation and plan construction: preserve the entire original bus search, then try source-origin connectors with midpoint tracks only when that search finds no plan. The existing isolated layer probe stays unchanged so a newly feasible top-layer turn cannot crowd out a previously successful bounded assignment. Width, clearance, atomic bus behavior and the no-via-in-pad rule stay enforced. Production changes are +41/−2 in four files, including the internal flag that preserves isolated layer screening.

Midpoint candidates alone and source-origin connectors alone each leave captured U22 at 9/32. Their combination reaches 14/32 with 6 diagnostic vias instead of 8 and zero clearance errors. Trying that combination before all original bus alternatives regresses fresh spaced U2 from 76/92 to 75/92 and adds a via; that ordering was rejected. The revised ordering reaches 77/92 with the original 37 vias and loses no baseline connection identities in either captured iCE/Pi case. A second rejected revision changed isolated layer discovery and broke an existing 18-layer fixture with a one-assignment budget; preserving the original probe restores its exact baseline output.

The narrow geometric fix is justified by a previously impossible-to-find valid zero-via escape and a small production diff. These results do not justify claiming whole-board completion or a timing improvement. Higher-impact remaining work includes breakout-edge capacity/placement, fanout layer-assignment cost, and bus/peripheral pathfinding. The i.MX6 obstruction must be addressed as an input/design-rule decision rather than by weakening clearance silently.

Repro and naturally updated before/after SVGs: [repro #328](https://github.com/tscircuit/fanout-solver/pull/328), [stacked fix #329](https://github.com/tscircuit/fanout-solver/pull/329).

## Unchanged-default controls

These runs use each uploaded default exactly as authored. Fanout is disabled. They expose later pipeline failures but do not represent the requested fanout-first workflow. [Raw audits](../baseline-audited.json.gz); [control artifacts](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44722526398).

| Circuit | Physical connected nets | Emitted traces / vias | Copper DRC findings | Last observed stage |
|---|---|---|---|---|
| butterstick-original | 9/317 | 0 / 0 | 0 | portPointPathingSolver |
| butterstick-spaced | 8/317 | 16 / 16 | 0 | finish_native_surface_carriers |
| glider-original | 5/356 | 537 / 322 | 42 | lanes_route |
| glider-spaced | 49/356 | 53 / 111 | 0 | portPointPathingSolver |
| h616-original | 2/121 | 221 / 140 | 3 | failed |
| h616-spaced | 53/121 | 57 / 91 | 3 | highDensityRouteSolver |
| icepi-original | 7/230 | 0 / 0 | 0 | effortCleanupSolver |
| icepi-spaced | 50/230 | 52 / 112 | 0 | portPointPathingSolver |
| imx6-original | N/A: hard process timeout | N/A | N/A | powerTraceExpansionSolver |
| imx6-spaced | 53/404 | 66 / 137 | 0 | portPointPathingSolver |

## PCB SVGs

These are the actual emitted PCB results. Failed fanout attempts are intentionally absent from committed PCB copper; use the PR’s native diagnostic views to inspect those attempts. Neither an unrouted board nor a partial result is presented as a solved PCB.

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
