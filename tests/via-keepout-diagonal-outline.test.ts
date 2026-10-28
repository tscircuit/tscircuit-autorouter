import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline } from "../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../lib/types"

test("routing crosses a diagonal stroked outline while keeping via copper clear", () => {
  const srj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.15, minViaDiameter: 0.6, bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 }, obstacles: [], connections: [{ name: "net", pointsToConnect: [{ x: -3, y: 0, layer: "top" }, { x: 3, y: 0, layer: "bottom" }] }], viaKeepouts: [{ shape: "outline", outline: [{x:-2,y:-2},{x:2,y:2}], strokeWidth: 0.2, layers: ["top", "bottom"] }] }
  const solver = new Pipeline(srj)
  solver.solve()
  expect(solver.failed).toBe(false)
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces).toHaveLength(1)
  const vias = traces.flatMap(t => t.route.filter(p => p.route_type === "via"))
  expect(vias.length).toBeGreaterThan(0)
  for (const via of vias) {
    const t = Math.max(0, Math.min(1, ((via.x+2)*4+(via.y+2)*4)/32))
    expect(Math.hypot(via.x-(-2+4*t),via.y-(-2+4*t))).toBeGreaterThanOrEqual(0.4-1e-9)
  }
})
