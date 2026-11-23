The fanout cleanup is independent of unmerged routing work. The review stack is **main → [#381](https://github.com/tscircuit/fanout-solver/pull/381) (before-only repro) → [#382](https://github.com/tscircuit/fanout-solver/pull/382) (fix)**.

The revised fix uses main's existing `getInitialViaPoint` and track-candidate generator to prefer source-aligned tracks in compact, unguided automatic boundary-only regions. The production change is three files, with 40 additions and 2 deletions. It does not include #379's general fallback, AM3354 fixture/test changes, visualization helper, or export additions.

| All ten full circuits, compared directly with main | Before | After |
|---|---:|---:|
| Raw partial first-region pad escapes | 723/1,024 | 758/1,024 (+4.8%) |
| Vias in partial fanouts | 429 | 446 |
| Partial fanout trace length | 2340.8 mm | 2118.2 mm (-9.5%) |
| Plane drops | 149 | 149 |
| Completed full boards | 0/10 | 0/10 |

These counts are pad-to-plane or pad-to-boundary escapes, not fully connected board nets. All ten full boards still stop at fanout; DDR bus lanes and remaining routing do not run. Full-board PCB outputs remain unchanged because partial fanout copper is not committed.

| Circuit | Escapes before → after | Vias before → after | Completed assignments | Best on common layer assignments |
|---|---:|---:|---:|---:|
| butterstick-original | 64 → 64 | 42 → 42 | 256 → 256 | 64 → 64 (256 shared) |
| butterstick-spaced | 78 → 80 | 49 → 50 | 256 → 256 | 77 → 77 (131 shared) |
| glider-original | 89 → 89 | 58 → 58 | 256 → 256 | 89 → 89 (256 shared) |
| glider-spaced | 135 → 161 | 67 → 85 | 33 → 39 | 108 → 145 (1 shared) |
| h616-original | 119 → 119 | 74 → 74 | 256 → 256 | 119 → 119 (256 shared) |
| h616-spaced | 111 → 112 | 72 → 67 | 192 → 204 | 109 → 111 (73 shared) |
| icepi-original | 23 → 23 | 11 → 11 | 256 → 256 | 23 → 23 (240 shared) |
| icepi-spaced | 77 → 82 | 37 → 41 | 256 → 256 | 76 → 81 (193 shared) |
| imx6-original | 20 → 20 | 15 → 15 | 256 → 256 | 20 → 20 (256 shared) |
| imx6-spaced | 7 → 8 | 4 → 3 | 256 → 256 | 7 → 8 (103 shared) |

Raw results include the unchanged wall-clock budget. Shared assignments are matched by their complete sorted bus-to-layer mapping; an assignment index alone is not treated as equivalent work when histories differ. Statistics retain same-prefix checks, gained/lost connection identities and actual via/length changes.

| Sample | Before full PCB | After full PCB | Partial fanout |
|---|---|---|---|
| butterstick-original | [SVG](main/full-boards/before/butterstick-original.svg) | [SVG](main/full-boards/after/butterstick-original.svg) | [before](main/butterstick-original-before.svg) · [after](main/butterstick-original-after.svg) |
| butterstick-spaced | [SVG](main/full-boards/before/butterstick-spaced.svg) | [SVG](main/full-boards/after/butterstick-spaced.svg) | [before](main/butterstick-spaced-before.svg) · [after](main/butterstick-spaced-after.svg) |
| glider-original | [SVG](main/full-boards/before/glider-original.svg) | [SVG](main/full-boards/after/glider-original.svg) | [before](main/glider-original-before.svg) · [after](main/glider-original-after.svg) |
| glider-spaced | [SVG](main/full-boards/before/glider-spaced.svg) | [SVG](main/full-boards/after/glider-spaced.svg) | [before](main/glider-spaced-before.svg) · [after](main/glider-spaced-after.svg) |
| h616-original | [SVG](main/full-boards/before/h616-original.svg) | [SVG](main/full-boards/after/h616-original.svg) | [before](main/h616-original-before.svg) · [after](main/h616-original-after.svg) |
| h616-spaced | [SVG](main/full-boards/before/h616-spaced.svg) | [SVG](main/full-boards/after/h616-spaced.svg) | [before](main/h616-spaced-before.svg) · [after](main/h616-spaced-after.svg) |
| icepi-original | [SVG](main/full-boards/before/icepi-original.svg) | [SVG](main/full-boards/after/icepi-original.svg) | [before](main/icepi-original-before.svg) · [after](main/icepi-original-after.svg) |
| icepi-spaced | [SVG](main/full-boards/before/icepi-spaced.svg) | [SVG](main/full-boards/after/icepi-spaced.svg) | [before](main/icepi-spaced-before.svg) · [after](main/icepi-spaced-after.svg) |
| imx6-original | [SVG](main/full-boards/before/imx6-original.svg) | [SVG](main/full-boards/after/imx6-original.svg) | [before](main/imx6-original-before.svg) · [after](main/imx6-original-after.svg) |
| imx6-spaced | [SVG](main/full-boards/before/imx6-spaced.svg) | [SVG](main/full-boards/after/imx6-spaced.svg) | [before](main/imx6-spaced-before.svg) · [after](main/imx6-spaced-after.svg) |


### Exact baseline and unchanged circuits

All **125 library files** on fanout main `7ed7a8c16db6a9058b716914f889534d706c846a` are byte-identical to the published fanout **0.0.104** source. [main-publication-proof.json](main-publication-proof.json) records that comparison. The already-completed published baseline [45070654984](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/45070654984) is therefore the actual main before-run; a duplicate benchmark is unnecessary.

The paired stack remains tscircuit **0.0.3280**, Core **0.0.2461** (`ce2683b98de40a7d4eaa4dc055ae105096c744d8`), fanout **0.0.104** plus only the reviewed three-file patch, capacity autorouter **0.0.1156**, bus lanes **0.0.65**, and winding **08d8da9d8dbb037eba332e7bfd685063f8805ed4**. Fanout's internal capacity dependency remains **0.0.718**. The revised routing source commit is `8defd8999b77572c2ea5a84c043e20a5fd23b414`; final PR head `c000bad2781ef331f3213cfe71e138b14adbe855` has the identical library tree (`cd3b4f18234158bc3e3218a3c9406b57cc3a25d8`). The repro declares `transformation-matrix` 3.1.0 as a test-only dependency for the native viewport. No routing dependency, version, or release change is made.

The dataset remains the ten uploaded original/spaced full-circuit H616, ButterStick, Glider, i.MX6 and iCE/Pi TSX samples. Archive SHA-256: `1991ad1891a953dcd660818aaceb73f7aa42dbf704e677e635753b9159f7a6b7`. Components, pads, net membership, original geometry and widths/clearances, fixed DDR placement, and through-via/via-in-pad restrictions are preserved. All copper is routed fresh. The ordering stays **fanout → DDR bus lanes → remaining routing**, with the original **256-assignment cap**, **600-second process budget**, preparation handling and **660-second external watchdog**.

### Failure locations and scope of the fix

The observer captures actual fanout constructor inputs, completed layer assignments, original clearance rejection geometry, winding stages and operation times without changing decisions. In nine baseline cases, most rejection checks are conflicts with already accepted copper. Long target-aligned jogs occupy neighboring source channels; preferring tracks through the existing source/via positions can leave those channels available. This changes ordering in the existing analytic search.

Requests with explicit targets, fixed tracks, corner/winding guidance or reservations keep their existing handling. Regions containing local plane drops keep main's candidate order. Candidate validation, bus atomicity and physical via restrictions remain authoritative.

The main comparison retains 149 → 149 plane drops. H616 original has 60 → 60 plane drops. Exact unchanged original-region outputs: butterstick-original, glider-original, h616-original, icepi-original, imx6-original. Rejection counts are candidate checks, not counts of disconnected nets; selected actual collision geometry is published under [failure-locations](failure-locations/).

A separate winding error in the spaced iCE/Pi circuit declares **17.43 mm** of required breakout-edge length against **14.64 mm** exposed. The ordering change does not repair that winding capacity problem. The source-net-aware geometry audit also proves that **seven requested pads in each i.MX6 variant** are enclosed by foreign-pad trace-clearance barriers, with no configured via fitting inside. It finds no such impossibility proof for the other eight circuits. Per-pad proof geometry is retained under [geometry-audit](geometry-audit/).

### Native repro and review

The same actual iCE/Pi region is used in the main-based before-only repro and the fix. All 92 requests, local pads and supplied rules are retained; irrelevant distant obstacles are omitted from the focused fixture. The test renders actual emitted copper through the native SVG renderer. Its second snapshot is a viewport onto the same SVG, using the existing graphics bounds and transform utilities, so crossing traces are clipped rather than omitted. No production visualization code is added.

| Native before | Native after |
|---|---|
| ![Before](https://raw.githubusercontent.com/tscircuit/fanout-solver/150228779f490eeb2dad3bb7fb63dc2673d1a9fa/tests/__snapshots__/repro-icepi-spaced-auto-handoffs.snap.svg) | ![After](https://raw.githubusercontent.com/tscircuit/fanout-solver/c000bad2781ef331f3213cfe71e138b14adbe855/tests/__snapshots__/repro-icepi-spaced-auto-handoffs.snap.svg) |
| ![Before](https://raw.githubusercontent.com/tscircuit/fanout-solver/150228779f490eeb2dad3bb7fb63dc2673d1a9fa/tests/__snapshots__/repro-icepi-spaced-auto-handoffs-source-channels.snap.svg) | ![After](https://raw.githubusercontent.com/tscircuit/fanout-solver/c000bad2781ef331f3213cfe71e138b14adbe855/tests/__snapshots__/repro-icepi-spaced-auto-handoffs-source-channels.snap.svg) |


Validation passed: [all-ten Core rerun](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/45117573719), [independent physical audit](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/45117702632), [main-based repro native macOS CI](https://github.com/tscircuit/fanout-solver/actions/runs/45119909119), and [independent fix native macOS CI](https://github.com/tscircuit/fanout-solver/actions/runs/45119935717).

The final-head [typecheck and format check](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/45120056849) also pass.

The audit checks identical constructor inputs, original circuit geometry and net membership, components/pads, original source-net aliases, native copper DRC, independent via/pad and drill spacing, bus atomicity with consistent layer/direction/via use, and route endpoints. No new structural issue or physical clearance violation is accepted. PCB SHA-256 values and route identities are retained in the published statistics and manifest.


This report supersedes the current PR's earlier #379-based comparison. The [previous measured stack](../compact-boundary-handoffs/analysis.md) remains archived as a separate experiment; its gain, plane-drop tradeoff and dedicated-via figures are not presented as results of the revised main-based fix.
