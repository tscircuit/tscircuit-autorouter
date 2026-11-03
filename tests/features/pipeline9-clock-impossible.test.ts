import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 reports an impossible zero-via clock without moving terminals or increasing limits", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 },
    obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 0.5, height: 4, layers: ["top"], connectedTo: [] }],
    connections: [{ name: "clock", pointsToConnect: [
      { x: -2, y: 0, layer: "top", pointId: "a" },
      { x: 2, y: 0, layer: "top", pointId: "b" },
    ] }],
    routeConstraints: [{ connectionName: "clock", sourceTraceId: "clock_rule", name: "X48_N", pointIds: ["a"], maxViaCount: 0, maxLength: 6 }],
  }
  const original = structuredClone(input)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input)
  solver.solve()
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.error).toBe("Cannot route X48_N with 0 vias within 6 mm")
  expect(input).toEqual(original)
})
