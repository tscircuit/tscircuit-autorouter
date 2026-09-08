# T113-S3 boot fanout and SD interface

This regression builds a real seven-component TSX circuit on every run. It uses
the complete 129-pad T113-S3 footprint, a 3.3 kΩ boot pulldown, five 0402 SD series
resistors, and a native bottom-layer GND pour. The land-pattern coordinates come
from the T113-S3 Linux board's imported component, without approximating its pads.
This is a routing regression circuit, not a complete Linux computer.

`getT113BootRoutingCircuit.tsx` declares the components and connections.
`getT113BootRoutingResult.ts` runs three native stages:

1. Pipeline 9 routes R_BOOT_SEL1.pin1 to U_SOC.PC5.
2. FanoutSolver routes R_BOOT_SEL1.pin2 to the GND plane. Its leftward escape
   preference and 3 mm component-boundary padding are ordinary fanout inputs;
   neither specifies any copper coordinates.
3. Pipeline 9 routes the five U_SOC.PF0–PF4 connections to R_SD0–R_SD4, using
   only the real outputs of the first two stages as preloaded copper.

There are no captured candidates, baked routing outputs, manually entered vias,
solver mocks, overwritten validation decisions, or manual routes. All 141 pads
remain obstacles. The first PR records the native routing failure and snapshots
the successfully completed boot stage with the SD connections still unrouted.
The stacked fix completes the SD routes and changes the actual ground escape.

The bug is the copper helper interpreting a diagonal layer transition's final
point as its via, even when the solver's explicit via is at the starting point.
That can accept a bad candidate which then fails final materialized validation.
The fix evaluates the actual copper while choosing a candidate, allowing the
native solver to select a valid alternative.

The PCB snapshot is the unmodified output of `convertCircuitJsonToPcbSvg`, using
the rendered TSX circuit and native output copper with the renderer's defaults.
There are no custom SVG elements, annotations, crops, zooms, or color overrides.

The fix checks the complete output with all original connection metadata. The
final phase alone contains only the five SD connections; passing only those to
the output checker loses the preloaded resistor's ground-port metadata and
incorrectly reports its intentional plane termination as disconnected. No DRC
errors are filtered or waived.

The newer core, React JSX runtime, and fanout solver are pinned as test-only
aliases, leaving the versions used by existing core integration tests unchanged.
Run both the native circuit and its SVG check with:

```sh
bun test tests/repro/pipeline9-t113-boot-fanout.test.ts --timeout 9999999
```

This test does not certify the full production board, its other routing stages,
or its manufacturing exports.
