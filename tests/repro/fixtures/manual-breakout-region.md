# Breakout routing bounds mistaken for physical board edges

The adjacent JSON is the unmodified first routing-phase input captured from
[`manual-breakoutpoints-preserve-plane-fanout.test.tsx`](https://github.com/tscircuit/core/blob/abf21739f3a2e4c932113663b17105949e5dea9a/tests/breakout/manual-breakoutpoints-preserve-plane-fanout.test.tsx)
in [core #4015](https://github.com/tscircuit/core/pull/4015).
The input was identical with capacity-autorouter 0.0.900 and 0.0.913.

Run the characterization test:

```sh
bun test tests/repro/pipeline9-breakout-bounds-extra-vias.test.ts --timeout 9999999
```

The physical board is 12x8mm, centered at the origin. Core replaces SRJ bounds
with the internal 4x4mm breakout region, x=[-5,-1], y=[-2,2], and does not supply
an outline for this rectangular board. DATA ends at the virtual breakout point
(-1.0001,-0.5). The board-edge margin is 0.2mm.

## Release bisect

| Published capacity-autorouter | DATA vias |
| --- | --- |
| 0.0.900 | 0 |
| 0.0.901, 0.0.902, 0.0.903, 0.0.904, 0.0.907, 0.0.913 | 2 |

The first affected release contains commit
[018f1fb2](https://github.com/tscircuit/tscircuit-autorouter/commit/018f1fb213996dcbbf23da72ad229ef9f2e58e6d),
[PR #2514](https://github.com/tscircuit/tscircuit-autorouter/pull/2514).
It enabled board-clearance evaluation in Pipeline9JointDrcRepairSolver.
`evaluateRelaxedDrc` constructs a physical board from `srj.bounds` when there is
no outline. An internal routing boundary therefore becomes a fabricated PCB edge.

## Stage isolation and control

The route has no vias through `globalDrcForceImproveSolver`. Before joint repair,
relaxed DRC reports zero errors without board clearance, and one false edge error
with board clearance: "Trace too close to board edge (0.000mm < 0.275mm required,
margin: 0.2mm)".

Joint repair adds DATA vias at approximately (-2.600,-0.432) and (-2.000,-0.330),
using inner1 between them. The false edge error remains after repair despite the
pipeline reporting solved. These are additional signal vias; the original two
GND plane drops in the core board are unchanged.

The first new via has only 0.04342259mm copper clearance from the unrelated GND
pad at (-2.5,0), below the 0.1mm requirement. Core reports this defect. The upstream
relaxed checker does not, so its displayed count is not a claim of full DRC safety.

With exactly the same routing bounds, connections, and obstacles, supplying the
actual physical outline (-6,-4), (6,-4), (6,4), (-6,4) yields zero signal vias and
zero relaxed DRC errors including board clearance. Setting the margin to zero or
removing the two out-of-region resistor pads does not eliminate the regression.

The test intentionally asserts the current buggy behavior alongside this control.
It is a reproduction, not a production fix. A fix needs to preserve the distinction
between routing-region bounds and physical board geometry, then require zero
signal vias for this case. Core can supply its actual rectangular outline when
using phase-local bounds; the autorouter also should not accept a repair that
leaves the triggering error while introducing invalid copper clearance.
