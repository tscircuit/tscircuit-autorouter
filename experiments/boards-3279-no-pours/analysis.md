# Latest board analysis

Runtime at the start of this run: tscircuit **0.0.3279**, core **0.0.2460**, capacity-autorouter **0.0.1154**, bundled fanout-solver **0.0.103**. All 19 original TSX boards use default routing with copper pours disabled. The TSX, render harness, and observer remain unchanged. Dependency versions, entry hashes, the baseline lockfile, and artifact digest are recorded beside this report.

The latest baseline still completes **0/19** boards. Sixteen emit partial results and three reach the 600-second render budget. All sixteen comparable outputs have exactly the same copper and error counts as the previous corrected run. All 187 captured pipeline inputs are unchanged. The blockers remain seven detailed-routing cases, six native fanout failures, four graph-search failures, and two bus-search budget cases. One of the detailed-routing cases reaches its failure near the render deadline and does not emit Circuit JSON.

## Selected fix

A regional repair uses A01 after B01 fails. A01 protects the target cell of a layer transition, but did not reserve the via copper radius around unrelated fixed terminals on every layer. A replacement via connecting signal layers 0–2 could cover a layer-3 boundary terminal. The repair accepted this candidate; a later B01 cell then failed because its terminal was obstructed.

The source change adds an optional physical via-to-port distance to the existing search (26 production lines). The consumer enables it explicitly only when a physical regional repair reconstructs movable preloaded copper (16 production lines). These replacements become preloaded copper for subsequent cells. Ordinary routing and regions containing only immutable native preloads retain their existing selection. No search strategy, sampling limit, tie breaker, extra budget, board-model propagation, or final-repair change is added.

Broader activation was rejected: it changed DDR routing and introduced copper contacts. An endpoint-layer exclusion was also rejected because it stopped the original circuit earlier. Passing extra fixed-route context to global repair and changing the deferred contact guard did not pass both DDR regression samples, so neither is included. The final explicit scope retains the 207-cell gain and restores both native DDR samples to their original DRC-clean snapshots.

Source Bun CI and source/consumer builds pass. The final consumer's nine Bun CI shards and frozen-lock 19-board comparison are running; their outcomes will be recorded below.

## Real reproduction

Two connection pairs are retained from an actual captured regional candidate. Coordinates are translated and identities are anonymized; geometry, layers, grid, copper dimensions, and route order are retained. The autorouter snapshot converts the observed 2x search frame back to board-world millimetres. It uses the regular `getBugReportSnapshotSvg` helper in a fixed before/after frame. Both native PCB PNGs were visually inspected. Cut-terminal continuity is disabled because this is a subcircuit without pads at its cut boundary; all copper checks remain enabled.

| Real subcircuit | Before | After |
| --- | ---: | ---: |
| Copper DRC errors | 1 | 0 |
| Routed connections | 2/2 | 2/2 |
| Terminals inside foreign through-via clearance | 1 | 0 |

| Before | After |
| --- | --- |
| ![Before](https://raw.githubusercontent.com/tscircuit/tscircuit-autorouter/cc95f4c1/tests/repro/__snapshots__/through-via-terminal-window.snap.svg) | ![After](https://raw.githubusercontent.com/tscircuit/tscircuit-autorouter/a32e89447c0a1427af4c44dd9d8d4b452d2c6fdf/tests/repro/__snapshots__/through-via-terminal-window.snap.svg) |

## PR stack

- Source repro: https://github.com/tscircuit/high-density-a01/pull/153
- Source fix: https://github.com/tscircuit/high-density-a01/pull/154
- Autorouter real PCB repro: https://github.com/tscircuit/tscircuit-autorouter/pull/4121
- Autorouter integration: https://github.com/tscircuit/tscircuit-autorouter/pull/4122

The source repro starts from the A01 commit already pinned by the latest autorouter, which is on the existing source PR #151. No tscircuit main-package PR was created.

## Paired board methodology

Blacksmith 32-vCPU ARM Ubuntu 24.04, Bun 1.4.3, 19 concurrent TSX renders, 600 seconds per board. The candidate installs the baseline's exact frozen lockfile. The source-equivalent change is applied to the release entry and the decoded/re-serialized Bun and Node worker sources. Per-bundle hashes and source commits are captured. All three bundles pass parser checks. A separate source/release comparison verifies equal constructor inputs and complete route geometry with the rule both disabled and enabled, plus four regional activation cases (`source-equivalence.json`). Earlier candidate runs are superseded and are not final regression evidence.

## Captured detailed-routing replay

The explicitly scoped production change was replayed against the same captured detailed-routing constructor input. The old failure at the fourth-layer boundary terminal disappears. Another independently constrained region still prevents completion.

| Captured detailed-routing input | Before | After |
| --- | ---: | ---: |
| Mesh cells completed | 1,477 | 1,684 |
| Route pieces emitted internally | 3,312 | 3,605 |
| Detailed-routing iterations | 432,804 | 278,385 |

These are internal pipeline counts, not fully connected board nets. The observed source/consumer subcircuit remains two connections routed in both versions.

The remaining native fanout results are 79/91, 83/95, 123/174, 13/32, 8/32 and 139/273 connections across the six circuit families after 256 assignment attempts each. They stop before this fix's routing stage. The graph-search cases also fail before detailed routing. The two bus cases remain bounded by the 600-second render budget. These upstream failures need separate routing work; this change does not report them as complete.

The observer also verifies saved copper remains in the SRJ trace list. In the local cases, native fixed traces grow from 0 to 8 to 16 while the count of obstacles lacking Circuit JSON metadata stays constant (10, 12, or 4 by board family), rather than growing by hundreds of rectangles per trace. Detailed routing receives native fixed-route primitives and real pad obstacles.
