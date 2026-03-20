import { test, expect } from "bun:test"
import { AssignableAutoroutingPipeline3 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline3/AssignableAutoroutingPipeline3"
import { SimpleRouteJson } from "lib/types"

test("E2E: AssignableAutoroutingPipeline3 with explicit nominalTraceWidth carries through pipeline", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -2, y: 0 },
        width: 0.6,
        height: 0.6,
        connectedTo: ["POWER"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 2, y: 0 },
        width: 0.6,
        height: 0.6,
        connectedTo: ["POWER"],
      },
    ],
    connections: [
      {
        name: "POWER",
        nominalTraceWidth: 0.6, // Explicit 0.6mm
        pointsToConnect: [
          { x: -2, y: 0, layer: "top" },
          { x: 2, y: 0, layer: "top" },
        ],
      },
    ],
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
  }

  const solver = new AssignableAutoroutingPipeline3(srj)
  solver.solve()

  expect(solver.solved).toBe(true)

  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces.length).toBeGreaterThanOrEqual(1)

  const powerTraces = traces.filter((t) => t.connection_name === "POWER")
  expect(powerTraces.length).toBeGreaterThanOrEqual(1)

  for (const trace of powerTraces) {
    const wireSegments = trace.route.filter((r) => r.route_type === "wire")
    expect(wireSegments.length).toBeGreaterThan(0)
    for (const seg of wireSegments) {
      if (seg.route_type === "wire") {
        expect(seg.width).toBeGreaterThanOrEqual(0.15)
      }
    }
  }
}, 30_000)
