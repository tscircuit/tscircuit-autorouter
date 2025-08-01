import { test, expect } from "bun:test"
import { CapacityMeshAutorouterCoreBinding } from "./fixtures/CapacityMeshAutorouterCoreBinding"
import type { SimpleRouteJson } from "../lib/types"

test("routes with different trace thicknesses", async () => {
  const simpleRouteJson: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        connectedTo: [],
      },
    ],
    connections: [
      {
        name: "signal_trace",
        pointsToConnect: [
          { x: -5, y: 0, layer: "top" },
          { x: 5, y: 0, layer: "top" },
        ],
        traceThickness: 0.15, // Standard signal trace
      },
      {
        name: "power_trace",
        pointsToConnect: [
          { x: -5, y: 2, layer: "top" },
          { x: 5, y: 2, layer: "top" },
        ],
        traceThicknessMultiplier: 4, // 4x thicker for power (0.6mm)
      },
      {
        name: "high_power_trace",
        pointsToConnect: [
          { x: -5, y: -2, layer: "top" },
          { x: 5, y: -2, layer: "top" },
        ],
        traceThickness: 1.2, // Explicit thick trace for high power
      },
    ],
    bounds: { minX: -10, maxX: 10, minY: -5, maxY: 5 },
  }

  const solver = new CapacityMeshAutorouterCoreBinding(simpleRouteJson)
  const traces = solver.solveSync()

  expect(traces).toBeDefined()
  expect(traces.length).toBe(3)

  // Check that each trace has the correct width
  const signalTrace = traces.find((t) =>
    t.pcb_trace_id?.includes("signal_trace"),
  )
  const powerTrace = traces.find((t) => t.pcb_trace_id === "power_trace_0")
  const highPowerTrace = traces.find(
    (t) => t.pcb_trace_id === "high_power_trace_0",
  )

  expect(signalTrace).toBeDefined()
  expect(powerTrace).toBeDefined()
  expect(highPowerTrace).toBeDefined()

  // Check wire widths in the routes
  const signalWires = signalTrace!.route.filter(
    (r: any) => r.route_type === "wire",
  )
  const powerWires = powerTrace!.route.filter(
    (r: any) => r.route_type === "wire",
  )
  const highPowerWires = highPowerTrace!.route.filter(
    (r: any) => r.route_type === "wire",
  )

  expect(signalWires.every((w: any) => w.width === 0.15)).toBe(true)
  expect(powerWires.every((w: any) => w.width === 0.6)).toBe(true)
  expect(highPowerWires.every((w: any) => w.width === 1.2)).toBe(true)
})
