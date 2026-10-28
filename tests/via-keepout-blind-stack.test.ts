import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline } from "../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../lib/types"

test("four-layer blind vias can use an allowed stack under a top-only keepout", () => {
  const srj: SimpleRouteJson = { layerCount: 4, allowBlindAndBuriedVias: true, minTraceWidth: 0.15, minViaDiameter: 0.6, bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 }, obstacles: [], connections: [{ name: "net", pointsToConnect: [{ x: -3, y: 0, layer: "inner1" }, { x: 3, y: 0, layer: "bottom" }] }], viaKeepouts: [{ shape: "rect", center: { x: 0, y: 0 }, width: 10, height: 10, layers: ["top"] }] }
  const solver = new Pipeline(srj)
  solver.solve()
  expect(solver.failed).toBe(false)
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces).toHaveLength(1)
  const vias = traces.flatMap(t => t.route.filter(p => p.route_type === "via"))
  expect(vias.length).toBeGreaterThan(0)
  for (const via of vias) {
    expect(via.from_layer).not.toBe("top")
    expect(via.to_layer).not.toBe("top")
    expect(via.layers?.includes("top") ?? false).toBe(false)
  }
})
