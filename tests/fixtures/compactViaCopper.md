# Compact retained wire/via copper

The AM3352 routing transcript at lines 1031–1034 describes a retained wire segment ending directly at a via being omitted from routing obstacles. This reduced public-API reproduction authors that shape through `<trace pcbPath>` and compiles it with the repository's existing pinned `tscircuit-for-pipeline9-fixtures` Core runtime (Core 0.0.1861). The same authored path was independently checked against published Core 0.0.2125 and emits the same three route points.

The fixture contains six real rectangular pads on a four-layer board. One fixed trace has a 3 mm TOP segment to a through-via and a 2 mm BOTTOM segment from it. Two unrelated pending nets cross those physical segments. `getSimpleRouteJsonFromCircuitJson` produces the SRJ used by the test. Nothing strips route points, inserts contacts, replaces obstacle geometry, or manually supplies new route shapes.

Before the fix, `getObstaclesFromSrjTraces` returns only the via reservation. The public native Pipeline 4 completes both new connections as straight lines through real retained copper. `checkEachPcbTraceNonOverlapping` independently reports two accidental contacts: TOP at (0, 0), BOTTOM at (1, 1). Pipeline 9's preload-to-HD converter separately drops the same 5 mm of copper, leaving only the vertical via transition. This test exercises its real converter without claiming a complete Pipeline 9 solve.

After the fix, both consumers keep the same physical wire/via segments. The unmodified native Pipeline 4 routes both connections around the fixed copper, and independent overlap DRC returns no errors. The input and existing route points remain unchanged.

The snapshots render the actual compiled pads, retained copper, converter reservations, native routes, and independent DRC result. The SVG is recomputed and compared to the committed expectation on every run. Regenerate its PNG alongside it with `UPDATE_COMPACT_VIA_SNAPSHOTS=1 bun test --timeout 9999999 tests/repro/compact-via-copper.test.ts`.

This is a reduced converter/native-consumer regression. It is not evidence that Core's separate `with-fixed-traces` phase wrapper has the same omission, nor that the AM3352 board is fully routed. Consecutive via-to-via records with missing wire points are a different issue: the transcript identifies a later operation stripping those points, and this reproduction does not manufacture that shape.
