# Trace Thickness Parameter Guide

## Overview

The autorouter now supports parameterized trace thickness for individual connections. This allows you to specify different trace widths for power traces, signal traces, and other connections based on your design requirements.

## Feature Description

Trace thickness (also called trace width) determines how wide the copper traces are on your PCB. The industry standard for data lines is 0.15mm, but power traces often need to be wider to handle higher current.

This implementation supports common trace width multiples:
- **1x (0.15mm)**: Standard data line thickness (default)
- **2x (0.3mm)**: Light power or high-speed signals
- **4x (0.6mm)**: Medium power traces
- **8x (1.2mm)**: Heavy power traces

## Usage

### Per-Connection Trace Width

You can specify trace width for individual connections using the `nominalTraceWidth` property:

```typescript
import { AutoroutingPipelineSolver } from "@tscircuit/capacity-autorouter"

const input = {
  layerCount: 2,
  minTraceWidth: 0.15,
  connections: [
    {
      name: "VCC",
      nominalTraceWidth: 0.6, // 4x multiple for power
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 10, y: 10, layer: "top" },
      ],
    },
    {
      name: "GND",
      nominalTraceWidth: 1.2, // 8x multiple for ground
      pointsToConnect: [
        { x: 0, y: 2, layer: "top" },
        { x: 10, y: 12, layer: "top" },
      ],
    },
    {
      name: "DATA",
      // No nominalTraceWidth specified, uses minTraceWidth (0.15mm)
      pointsToConnect: [
        { x: 0, y: 4, layer: "top" },
        { x: 10, y: 14, layer: "top" },
      ],
    },
  ],
  obstacles: [],
  bounds: { minX: -5, maxX: 15, minY: -5, maxY: 20 },
}

const solver = new AutoroutingPipelineSolver(input)
solver.solve()
const output = solver.getOutputSimpleRouteJson()
```

### Global Default Trace Width

You can also set a global default trace width that applies to all connections that don't specify their own:

```typescript
const input = {
  layerCount: 2,
  minTraceWidth: 0.15,
  nominalTraceWidth: 0.3, // Global default (2x)
  connections: [
    {
      name: "POWER",
      nominalTraceWidth: 1.2, // Overrides global default
      pointsToConnect: [/* ... */],
    },
    {
      name: "SIGNAL",
      // Uses global nominalTraceWidth (0.3mm)
      pointsToConnect: [/* ... */],
    },
  ],
  // ...
}
```

## How It Works

### 1. Initial Routing

During high-density routing, each route is assigned its specified `nominalTraceWidth`:
- The solver looks up the connection's `nominalTraceWidth`
- If not specified, it falls back to the global `nominalTraceWidth` or `minTraceWidth`
- Routes are created with the appropriate `traceThickness` value

### 2. Width Adjustment

The `TraceWidthSolver` runs after routing to adjust trace widths based on available clearance:
- It attempts to use the full `nominalTraceWidth` specified
- If obstacles or other traces are too close, it narrows the trace
- The width schedule tries: `[nominalTraceWidth, (nominal + min)/2, minTraceWidth]`
- The widest possible trace that fits is used

### 3. Output

The final traces in `SimplifiedPcbTraces` include the determined width:

```typescript
{
  type: "pcb_trace",
  pcb_trace_id: "trace_1",
  connection_name: "VCC",
  route: [
    {
      route_type: "wire",
      x: 0,
      y: 0,
      width: 0.6, // Determined trace width
      layer: "top"
    },
    // ...
  ]
}
```

## Best Practices

### Choosing Trace Widths

1. **Power Traces**: Use 4x-8x multiples (0.6-1.2mm) for power distribution
2. **Ground Traces**: Use 4x-8x multiples, or pour ground planes
3. **Signal Traces**: Use 1x-2x multiples (0.15-0.3mm) for most signals  
4. **High-Speed Signals**: Consider controlled impedance, may need specific widths

### Current Capacity

Approximate current capacity for common trace widths (1oz copper):
- 0.15mm (1x): ~0.3A
- 0.3mm (2x): ~0.7A
- 0.6mm (4x): ~1.5A
- 1.2mm (8x): ~3.0A

*Note: These are rough estimates. Always verify with a trace width calculator for your specific requirements.*

### Clearance Considerations

Wider traces require more clearance:
- Ensure adequate spacing between traces
- Consider board size and component density
- The autorouter will narrow traces if needed to fit

## Example: Mixed Trace Widths

```typescript
const input = {
  layerCount: 2,
  minTraceWidth: 0.15,
  connections: [
    {
      name: "VCC_5V",
      nominalTraceWidth: 0.6, // 4x for 5V power
      pointsToConnect: [/* ... */],
    },
    {
      name: "VCC_3V3",
      nominalTraceWidth: 0.3, // 2x for 3.3V power
      pointsToConnect: [/* ... */],
    },
    {
      name: "GND",
      nominalTraceWidth: 1.2, // 8x for ground
      pointsToConnect: [/* ... */],
    },
    {
      name: "SDA",
      nominalTraceWidth: 0.15, // 1x for I2C data
      pointsToConnect: [/* ... */],
    },
    {
      name: "SCL",
      nominalTraceWidth: 0.15, // 1x for I2C clock
      pointsToConnect: [/* ... */],
    },
  ],
  obstacles: [/* ... */],
  bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
}
```

## Implementation Details

### Modified Components

1. **SimpleHighDensitySolver**: Enhanced to use per-connection trace widths
2. **JumperHighDensitySolver**: Enhanced to use per-connection trace widths
3. **CurvyIntraNodeSolver**: Enhanced to use per-connection trace widths  
4. **AssignableAutoroutingPipeline2**: Updated to pass trace width mapping
5. **TraceWidthSolver**: Already supported `nominalTraceWidth`, no changes needed

### Utility Functions

- **`getConnectionTraceWidthMap()`**: Creates a mapping from connection names to their specified trace widths, with fallback to default values

## Limitations

1. **Capacity Planning**: The capacity mesh calculations don't yet fully account for trace thickness. This is a known limitation for very dense boards with thick traces.

2. **Probability Calculations**: Routing probability calculations assume uniform trace width. Mixed widths may affect success rates on dense boards.

3. **Single-Layer Boards**: Trace thickness considerations are less critical for jumper-based routing on single-layer boards.

## Future Enhancements

Potential improvements for future releases:
- Capacity-aware routing that reserves appropriate space for thick traces
- Probability calculations that account for trace thickness
- Automatic trace width calculation based on net current requirements
- Trace adjacency behavior (combining nearby traces for the same net)

## Related

- See [Issue #66](https://github.com/tscircuit/tscircuit-autorouter/issues/66) for the original feature request
- See `tests/features/trace-thickness/` for test examples
- See `fixtures/features/trace-thickness/` for interactive examples
