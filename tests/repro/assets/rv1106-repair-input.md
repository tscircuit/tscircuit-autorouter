# RV1106 repair-stage input

The compressed fixture contains the full 50 × 50 mm, four-layer board's
repair-stage input: 791 nodes, 1,413 route sections, obstacles, and the
connectivity map. Component placement is unchanged.

Captured from the remaining-connections phase after tiny-hypergraph pathing
and Pipeline9 detailed routing completed. Autorouter source: `2d4ebf7548dbaea30ed39178d2a187b40515bbf8`;
tiny-hypergraph: `c1043b3043ddf0c4d841fe5a6d9a515165960911` with the owner-search
optimization from tiny-hypergraph PR #181. Capture took 912 seconds.

The wrapper's constructor serialization omits nodes when its limit skips all
samples. The fixture restores those nodes from the saved detailed-routing
input, and restores `ConnectivityMap` from its serialized `netMap`.
No routes were regenerated or manually edited.

Run `bun test tests/repro/rv1106-repair-limit.test.ts --timeout 9999999`.
The full-board and detail snapshots show repair-stage route geometry, not a
completed PCB or a full-board DRC pass. The boundary metric covers the first
80 samples at the captured 0.2 mm repair margin.

## Pipeline 9 and board autorouting phases

The test instantiates `AutoroutingPipelineSolver9_PreloadedTraceGraph` and
executes its registered `highDensityRepairSolver` stage from the captured
post-force-improve checkpoint. It does not run Pipeline 4. Pipeline 9 currently
uses the shared class named `Pipeline4HighDensityRepairSolver` for this stage.

The board uses `<autoroutingphase>` in this order:

| Phase index | Name | Incoming traces | Cumulative output traces |
| --- | --- | ---: | ---: |
| 0 | clocks | 0 | 11 |
| 1 | boot-flash | 11 | 21 |
| 2 | remaining | 21 | Repair-stage checkpoint only |

`rv1106-autorouting-phases.json.gz` contains all three actual phase inputs and
the completed outputs of phases 0 and 1. The test checks the exact trace
handoff between phases and the 36 remaining-phase connections. The original
routing log identifies Pipeline 9 for every phase. The test replays the repair
checkpoint; it does not rerun the preceding phases or the long graph search.
