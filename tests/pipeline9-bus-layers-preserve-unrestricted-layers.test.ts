import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("a restricted bus does not remove inner layers from unrelated connections", () => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.2,
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 2, height: 20, layers: ["top"], connectedTo: [] }],
    connections: [
      { name: "restricted", pointsToConnect: [{ x: -5, y: -3, layer: "top" }, { x: 5, y: -3, layer: "top" }] },
      { name: "free", pointsToConnect: [{ x: -5, y: 3, layer: "top" }, { x: 5, y: 3, layer: "top" }] },
    ],
    buses: [{ busId: "OuterOnly", connectionNames: ["restricted"], allowedLayers: ["top", "bottom"] }],
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj)
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  const traces = solver.getOutputSimplifiedPcbTraces()
  const restrictedLayers = new Set(traces.filter((trace) => trace.connection_name === "restricted").flatMap((trace) => trace.route.filter((point) => point.route_type === "wire").map((point) => point.layer)))
  const unrestrictedLayers = new Set(traces.filter((trace) => trace.connection_name === "free").flatMap((trace) => trace.route.filter((point) => point.route_type === "wire").map((point) => point.layer)))
  expect([...restrictedLayers].sort()).toEqual(["bottom", "top"])
  expect(unrestrictedLayers.has("inner1") || unrestrictedLayers.has("inner2")).toBe(true)
})
