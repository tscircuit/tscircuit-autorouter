import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { SimpleRouteJson } from "lib/types"

/**
 * Example demonstrating different trace thicknesses for different types of connections:
 * - Signal traces: 0.15mm (standard)
 * - Power traces: 0.6mm (4x multiplier)
 * - High-power traces: 1.2mm (8x multiplier)
 */
export const simpleRouteJson: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.1,
  obstacles: [
    // Add some obstacles to make routing more interesting
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      connectedTo: [],
    },
  ],
  connections: [
    // Standard signal trace (0.15mm)
    {
      name: "signal_data",
      pointsToConnect: [
        { x: -8, y: 3, layer: "top" },
        { x: 8, y: 3, layer: "top" },
      ],
      traceThickness: 0.15, // Explicit standard thickness
    },

    // Signal trace using default (should be 0.15mm)
    {
      name: "signal_clock",
      pointsToConnect: [
        { x: -8, y: 1, layer: "top" },
        { x: 8, y: 1, layer: "top" },
      ],
      // No trace thickness specified - should use default 0.15mm
    },

    // Medium power trace using multiplier (0.3mm = 2x)
    {
      name: "power_3v3",
      pointsToConnect: [
        { x: -8, y: -1, layer: "top" },
        { x: 8, y: -1, layer: "top" },
      ],
      traceThicknessMultiplier: 2, // 2x standard thickness = 0.3mm
    },

    // High power trace using multiplier (0.6mm = 4x)
    {
      name: "power_5v",
      pointsToConnect: [
        { x: -8, y: -3, layer: "top" },
        { x: 8, y: -3, layer: "top" },
      ],
      traceThicknessMultiplier: 4, // 4x standard thickness = 0.6mm
    },

    // Very high power trace with explicit thickness (1.2mm = 8x)
    {
      name: "power_12v",
      pointsToConnect: [
        { x: -8, y: -5, layer: "top" },
        { x: 8, y: -5, layer: "top" },
      ],
      traceThickness: 1.2, // Explicit thick trace for high current
    },

    // Trace with custom via diameter
    {
      name: "power_main",
      pointsToConnect: [
        { x: -6, y: 5, layer: "top" },
        { x: 6, y: 5, layer: "bottom" }, // Force layer change to create via
      ],
      traceThickness: 0.8,
      viaDiameter: 1.0, // Large via for high current
    },
  ],
  bounds: { minX: -10, maxX: 10, minY: -7, maxY: 7 },
}

export default () => {
  return (
    <div>
      <h2>Trace Thickness Example</h2>
      <p>This example demonstrates different trace thicknesses:</p>
      <ul>
        <li>
          <strong>signal_data:</strong> 0.15mm (explicit standard)
        </li>
        <li>
          <strong>signal_clock:</strong> 0.15mm (default)
        </li>
        <li>
          <strong>power_3v3:</strong> 0.3mm (2x multiplier)
        </li>
        <li>
          <strong>power_5v:</strong> 0.6mm (4x multiplier)
        </li>
        <li>
          <strong>power_12v:</strong> 1.2mm (explicit thick)
        </li>
        <li>
          <strong>power_main:</strong> 0.8mm with 1.0mm via
        </li>
      </ul>
      <AutoroutingPipelineDebugger srj={simpleRouteJson} />
    </div>
  )
}
