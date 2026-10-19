import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("a multilayer terminal selects a bus-permitted access layer", () => {
  const srj: SimpleRouteJson = {
    layerCount: 4, minTraceWidth: 0.2,
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    obstacles: [],
    connections: [{ name: "signal", pointsToConnect: [{ x: -5, y: 0, layers: ["inner1", "bottom"] }, { x: 5, y: 0, layer: "bottom" }] }],
    buses: [{ busId: "OuterOnly", connectionNames: ["signal"], allowedLayers: ["top", "bottom"] }],
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj)
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces).toHaveLength(1)
  const wireLayers = new Set(traces.flatMap((trace) => trace.route.filter((point) => point.route_type === "wire").map((point) => point.layer)))
  expect([...wireLayers]).toEqual(["bottom"])
  expect(srj.connections[0]!.pointsToConnect[0]!.layers).toEqual(["inner1", "bottom"])
})
