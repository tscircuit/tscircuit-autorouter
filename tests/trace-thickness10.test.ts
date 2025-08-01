import { test, expect } from "bun:test"
import { CapacityMeshAutorouterCoreBinding } from "./fixtures/CapacityMeshAutorouterCoreBinding"
import type { SimpleRouteJson } from "../lib/types"

test("routes with custom via diameters", async () => {
  const simpleRouteJson: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 1 },
        width: 1,
        height: 1,
        connectedTo: [],
      },
    ],
    connections: [
      {
        name: "thick_trace_with_large_via",
        pointsToConnect: [
          { x: -3, y: 0, layer: "top" },
          { x: 3, y: 0, layer: "bottom" }, // Force a via
        ],
        traceThickness: 0.6,
        viaDiameter: 1.0, // Large via for thick trace
      },
    ],
    bounds: { minX: -5, maxX: 5, minY: -3, maxY: 3 },
  }

  const solver = new CapacityMeshAutorouterCoreBinding(simpleRouteJson)
  const traces = solver.solveSync()

  expect(traces).toBeDefined()
  expect(traces.length).toBe(1)

  const trace = traces[0]
  const wires = trace.route.filter((r: any) => r.route_type === "wire")
  const vias = trace.route.filter((r: any) => r.route_type === "via")

  // Check that wires have correct thickness
  expect(wires.every((w: any) => w.width === 0.6)).toBe(true)

  // Check that vias are present (layer change should create vias)
  expect(vias.length).toBeGreaterThan(0)
})
