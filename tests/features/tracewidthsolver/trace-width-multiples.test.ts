import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { SimpleRouteJson } from "lib/types"

test("Trace width multiples - wide gap uses nominalTraceWidth 0.6mm", async () => {
  const input: SimpleRouteJson = {
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles: [],
    connections: [
      {
        name: "conn1",
        nominalTraceWidth: 0.6,
        pointsToConnect: [
          { x: -5, y: 0, layer: "top" },
          { x: 5, y: 0, layer: "top" },
        ],
      },
    ],
  }

  const solver = new AutoroutingPipelineSolver4(input)
  solver.solve()

  expect(solver.solved).toBe(true)
  const output = solver.getOutputSimpleRouteJson()
  const trace = output.traces?.[0]
  expect(trace).toBeDefined()

  const wire = trace?.route.find((r) => r.route_type === "wire")
  expect(wire).toBeDefined()
  if (wire && wire.route_type === "wire") {
    expect(wire.width).toBe(0.6)
  }
})

test("Trace width multiples - narrow gap steps down to 0.3mm", async () => {
  const input: SimpleRouteJson = {
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    layerCount: 2,
    minTraceWidth: 0.15,
    defaultObstacleMargin: 0.15,
    minTraceToPadEdgeClearance: 0.15,
    obstacles: [
      {
        type: "rect",
        layers: ["top", "bottom"],
        center: { x: 0, y: 1.0 },
        width: 1.0,
        height: 1.2,
        connectedTo: [],
      },
      {
        type: "rect",
        layers: ["top", "bottom"],
        center: { x: 0, y: -1.0 },
        width: 1.0,
        height: 1.2,
        connectedTo: [],
      },
    ],
    connections: [
      {
        name: "conn1",
        nominalTraceWidth: 0.6,
        pointsToConnect: [
          { x: -5, y: 0, layer: "top" },
          { x: 5, y: 0, layer: "top" },
        ],
      },
    ],
  }

  const solver = new AutoroutingPipelineSolver4(input)
  solver.solve()

  expect(solver.solved).toBe(true)
  const output = solver.getOutputSimpleRouteJson()
  const trace = output.traces?.[0]
  expect(trace).toBeDefined()

  const wires = trace?.route.filter((r) => r.route_type === "wire")
  expect(wires?.length).toBeGreaterThan(0)
  for (const wire of wires ?? []) {
    if (wire.route_type === "wire") {
      expect(wire.width).toBe(0.3)
    }
  }
})
