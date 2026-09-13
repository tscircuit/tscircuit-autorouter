# Native Game Boy dangling BOTTOM copper at TOP-only terminals

This is the untouched first-and-only global Simple Route JSON input from a
fully flat native TSCI build: 137 connections, 452 obstacles, two layers,
through vias only, no previous traces, and five retained TOP clock buses.
No output routes, breakout points, synthetic barriers or changed obstacles
are supplied to the solver.

Input SHA256:
`5bb0c18339ac7f2a835578689dcf4599f9d9617c96f498ce0f6e3f6e67af3bf6`.

## Observed in the published package

The native TSCircuit 0.0.2547 / Core 0.0.1906 / autorouter 0.0.900 build
finished with 310 output traces and zero router errors. Its raw returned
PCB traces include these **additional** islands:

| Trace | Real terminals | Returned island |
| --- | --- | --- |
| `source_net_0_mst25_0` | XTAL.GND1 to C_XIN ground, both TOP-only | Six BOTTOM wire points, zero vias |
| `source_trace_245_0` | SW_UP to U1.pin4, both TOP-only | Five BOTTOM wire points, zero vias |

Each connection also has a separate `_1` route with TOP ends and through
vias. The additional `_0` copper is not a valid alternative layer connection:
its ends do not reach same-net BOTTOM copper. The measured gaps are
0.759676/0.719587 mm for the crystal-ground island and
20.751649/0.852077 mm for the UP-button island.

The endpoint coordinates and PCB-port IDs match the original input.
Core preserves the raw route geometry and reports four disconnected
endpoints. This is not a source-net alias false positive or Core moving
otherwise valid copper to another layer.

## Current-main replay

The test runs Pipeline9 from current upstream main (0.0.905) once, without
a cache. It generates one repository-native SVG snapshot through
`getBugReportSnapshotSvg` and saves its unmodified returned traces as a CI
artifact. No local router/repository solve, benchmark, hand-authored output,
or production code/dependency change is part of this PR.

Latest-905 reproduction is **pending CI inspection**. This observational
test does not assert that the old bad islands or old DRC counts must persist.
If latest main no longer produces the defect, this report should be closed
as already fixed rather than manufacturing a failing output.

The SVG helper's relaxed-DRC overlay is not a complete Core endpoint,
connectivity or fabrication check.

## Suspected stage, not a proven sole cause

Current Pipeline9's global-DRC stage passes terminal identities to
`lockHdRouteTerminals` in a map keyed only by connection name. The locking
utility applies those terminal identities to every same-name route island,
restoring endpoint X/Y but retaining each point's Z. The stitcher may retain
multiple islands for one connection. That combination can explain a
BOTTOM-only interior island being stretched to TOP PCB-terminal coordinates
without vias. Intermediate-stage evidence is still needed before attributing
the captured fault exclusively to terminal locking.

No repair, coordinate correction, filtering of bad islands, suppressed
checks or other implementation fix is included.
