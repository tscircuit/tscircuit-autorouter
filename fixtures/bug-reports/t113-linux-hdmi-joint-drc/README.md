# T113-S3 Linux HDMI routing regression

These fixtures capture the exact 96-component TSX circuit used to validate the
Allwinner T113-S3 Linux board after its HDMI bridge batch was added.

- `t113-linux-hdmi-unrouted.circuit.json.gz` is the real board Circuit JSON with
  routed copper removed. It retains all 96 source and PCB components, pads,
  plated holes, board geometry, and net connectivity.
- `t113-linux-hdmi-joint-drc-input.json.gz` is the real Pipeline9 joint-repair
  input captured after routing the same circuit. It contains the original SRJ,
  all 342 updated preloaded traces, and the 42 newly routed traces.
- `t113-linux-soc-fanout-phase-input.json.gz` is the real 80-connection
  Pipeline9 input for the T113-S3 fanout signal phase. It retains the 33 plane
  fanout traces produced by the preceding phase and all 462 board obstacles.
- `t113-linux-hdmi-full-pipeline.srj.json.gz` is the final full-pipeline input
  from the same board. It retains 29 remaining signal connections, 397
  obstacles, and all 342 traces routed by the preceding component batches.

The regression occurred where two same-net preloaded branches shared one via
next to the U4 `SW2` pad. Copper conversion deduplicated that physical via, but
DRC ownership identified only one branch. Moving one owner left the other at
the original coordinate, so Pipeline9 published an unrouted result. The repair
tracks every route that owns a shared via and moves the complete site as one
atomic candidate.

The SoC fanout phase also reproduced a mixed final error set containing one
trace-pair clearance error and one via-pad clearance error. Geometry precision
must run before via-pad cleanup so the independently repairable trace pair is
not skipped, and pad lookup must prefer the exact pad identity over a different
pad on the same net.

The full-pipeline fixture reproduces two additional interactions from the real
board: a physical zero-length preloaded fragment entering the HD route graph,
and a power-rail trace that needs a bounded detour around immutable fanout
copper. The final precision pass measures the trace pair beyond the checker's
rounded diagnostic and keeps a 0.01 mm margin before publishing the route.

The matching test produces a single SVG snapshot with the exact unrouted PCB
on the left and the routed PCB on the right.
