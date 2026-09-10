# RV1106 final same-net vias

Full 50 × 50 mm, four-layer RV1106G2 board, with top-side components and
explicit clocks → boot-flash → remaining autorouting phases.

- `phases.json.gz` contains the complete clocks input/output (11 traces),
  boot-flash input/output (21 traces), and remaining-phase input (36 connections).
- `checkpoint.json.gz` contains the captured Pipeline9 detailed-routing output,
  pathing output, fixed-route replacements, and preloaded mutation masks.
- The test resumes at Pipeline9's registered high-density repair stage and runs
  all remaining stages, including joint repair and final trace expansion.
  It does not repeat tiny-hypergraph search or regenerate the board in core.
- The five phase snapshots show each phase input and the two captured earlier
  outputs. `rv1106-final-vias.snap.svg` is the final full-board output.

Run from the repository root:

```sh
bun test tests/repro/rv1106-final-vias.test.ts --timeout 300000
```

The repro base is autorouter PR #2518 (repair03 fixes pinned), not the separate
bounded-repair branch in #2516. This exact replay has 36 relaxed DRC reports,
including nine via-spacing reports. Do not compare its count with a different
branch or use the native repair-stage counter as the final relaxed DRC count.

The snapshots and assertions use the existing relaxed checker without changing
its rules. Remaining errors still require repair; this is not a fabrication-ready
board.

Net-wide final same-net via repair (#2520) leaves 29 relaxed DRC reports.
Trying independent routes when a net-wide merge is rejected reduces this to 26:
23 trace errors, zero via-spacing errors, two via-trace errors, and one
pad-trace error. The other routes stay fixed during each local attempt.
Candidates are accepted only when the total decreases and every remaining
conflict is unchanged (including exact measured clearance and physical location).
