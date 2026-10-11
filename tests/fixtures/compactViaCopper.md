# Compact retained wire/via copper

The AM3352 routing transcript at lines 1031–1034 describes a retained wire segment ending directly at a via being omitted from routing obstacles. This reduced public-API reproduction authors that shape through `<trace pcbPath>` and compiles it with the repository's existing pinned `tscircuit-for-pipeline9-fixtures` Core runtime (Core 0.0.1861). The same authored path was independently checked against published Core 0.0.2125 and emits the same three route points.

The fixture contains six real rectangular pads on a four-layer board. One fixed trace has a 3 mm TOP segment to a through-via and a 2 mm BOTTOM segment from it. Two unrelated pending nets cross those physical segments. `getSimpleRouteJsonFromCircuitJson` produces the SRJ used by the test. Nothing strips route points, inserts contacts, replaces obstacle geometry, or manually supplies new route shapes.

Before the fix, `getObstaclesFromSrjTraces` returns only the via reservation. The public native Pipeline 4 completes both new connections as straight lines through real retained copper. `checkEachPcbTraceNonOverlapping` independently reports two accidental contacts: TOP at (0, 0), BOTTOM at (1, 1). Pipeline 9's preload-to-HD converter separately drops the same 5 mm of copper, leaving only the vertical via transition. This test exercises its real converter without claiming a complete Pipeline 9 solve.

After the fix, both consumers keep the same physical wire/via segments. The unmodified native Pipeline 4 routes both connections around the fixed copper, and independent overlap DRC returns no errors. The input and existing route points remain unchanged.

The snapshots render the actual compiled pads, retained copper, converter reservations, native routes, and independent DRC result. The SVG is recomputed and compared to the committed expectation on every run. Regenerate its PNG alongside it with `UPDATE_COMPACT_VIA_SNAPSHOTS=1 bun test --timeout 9999999 tests/repro/compact-via-copper.test.ts`.

This is a reduced converter/native-consumer regression. It is not evidence that Core's separate `with-fixed-traces` phase wrapper has the same omission, nor that the AM3352 board is fully routed. Consecutive via-to-via records with missing wire points are a different issue: the transcript identifies a later operation stripping those points, and this reproduction does not manufacture that shape.

## Physical-equivalence and checker control

`compact-via-copper-contact-control.test.ts` authors an otherwise identical TSX circuit with explicit zero-length wire contacts at the via. Both independently compiled inputs contain exactly the same two physical copper segments and via coordinate. The contact-expanded control routes successfully on unchanged upstream and passes the full `getDrcErrors` checks. The test also verifies the compiled board has four copper layers and every generated layer name belongs to that stack.

Full DRC on the compact fixture additionally reports one inherited `misaligned_via_pcb_trace_0_1` warning, before and after the router fix. It comes from `checkTracesAreContiguous` in the repository-pinned `@tscircuit/checks` 0.0.233: its interior-via loop requires both neighboring wire points to be colocated with the via. The test asserts this warning explicitly; it is not suppressed. The production patch stays in the router converters. An open related checker PR, [checks #381](https://github.com/tscircuit/checks/pull/381), handles onward copper at terminal via landings rather than these nonzero interior compact edges. A search for the exact misaligned-via report found no existing PR.

The same untouched compact/control Circuit JSON was also checked with freshly installed published checks 0.0.247. The compact input still reports exactly `misaligned_via_pcb_trace_0_1`; the contact-expanded control reports none. Its generated `dist/index.js` lines 5494–5514 still compare both neighboring wire coordinates with the via rather than accepting nonzero wire-to-via and via-to-wire segments. This confirms the checker limitation is current, not only a property of the repository's older pinned checker.

## Existing Pipeline 9 diagnostic changes

The separate existing `pipeline9-default-via-is-through-hole-visual.test.ts` fixture changes because its preload HD graph now includes its actual wire segments. Pipeline 9 permits preloaded-route replacement through `getMutatedPreloadedTraces()` and explicit `__replaces_pcb_trace_id` output metadata. Its joint DRC repair moves that fixture's via from (0, 0) to (0, 1), replacing the former INNER2 lateral wire with TOP copper while preserving both preload endpoints and the pending BOTTOM connection endpoints. The evaluated default via still spans all four board layers.

This diagnostic output is already produced by unchanged upstream when the same physical preload is encoded with explicit colocated via contact wires. The revised test runs that physical-equivalence control and compares its native output exactly. Its independent full and relaxed DRC results both remain the same four disconnected-endpoint errors, because this reduced fixture has no pads. The expected snapshot is updated with those errors visible. It is not an end-to-end Pipeline 9 success claim or a change to preloaded-route immutability policy.
