import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("pipeline9 routes a top/bottom-only bus around a top-layer barrier", () => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.2,
    minViaPadDiameter: 0.6,
    minViaHoleDiameter: 0.3,
    allowBlindAndBuriedVias: false,
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    obstacles: [{
      type: "rect",
      center: { x: 0, y: 0 },
      width: 2,
      height: 20,
      layers: ["top"],
      connectedTo: [],
    }],
    connections: [{ name: "signal", pointsToConnect: [
      { x: -5, y: 0, layer: "top" },
      { x: 5, y: 0, layer: "top" },
    ] }],
    buses: [{ busId: "OuterOnly", connectionNames: ["signal"], allowedLayers: ["top", "bottom"] }],
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj)
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces).toHaveLength(1)
  const wireLayers = new Set(traces.flatMap((trace) => trace.route
    .filter((point) => point.route_type === "wire")
    .map((point) => point.layer)))
  expect([...wireLayers].sort()).toEqual(["bottom", "top"])
})
