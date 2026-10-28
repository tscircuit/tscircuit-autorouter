# via-in-pad topology overlap

A 4-layer board with a 6x6, 0.8mm-pitch BGA. A through via (0.3mm, all
layers) is drilled into the 0.4mm pad of the inner ball at (-0.4, -0.4), on
the same net, and that ball connects to a 0402 resistor about 7mm away.

The SRJ was emitted by tscircuit/core 0.0.2222 (before tscircuit/core#4983)
from a `<via>` placed at the pad center with `connectsTo` the pad's port.

Pipeline 9 fails in `TopologyMergingSolver`: the global target node for the
via owns the pad's layer inside the pad, but the component target node for
the pad is then restored to its full bounds, overlapping it.
