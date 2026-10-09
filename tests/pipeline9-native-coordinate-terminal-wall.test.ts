import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"

test("native four-layer coordinate terminals retain a clean outer route across a top wall", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 4, allowBlindAndBuriedVias: false, minTraceWidth: 0.1,
    minViaPadDiameter: 0.3, minViaHoleDiameter: 0.15, defaultObstacleMargin: 0.1,
    minBoardEdgeClearance: 0.2,
    bounds: { minX: -6, maxX: 6, minY: -6, maxY: 6 },
    outline: [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }],
    obstacles: [
      ...["inner1", "inner2"].map(layer => ({
        type: "rect" as const, layers: [layer], center: { x: 0, y: 0 }, width: 10, height: 10,
        isCopperPour: true, connectedTo: ["GROUND"],
      })),
      { type: "rect", layers: ["top"], center: { x: 0, y: 0 }, width: 0.5, height: 10, connectedTo: [] },
    ],
    connections: [{ name: "DATA", pointsToConnect: [{ x: -3, y: 0, layer: "top" }, { x: 3, y: 0, layer: "top" }] }],
  }
  const original = JSON.stringify(input)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, { capacityDepth: 5, effort: 0.1, cacheProvider: null })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces.length).toBeGreaterThan(0)
  const vias = traces.flatMap(trace => trace.route.filter(point => point.route_type === "via"))
  expect(vias.length).toBeGreaterThanOrEqual(2)
  for (const trace of traces) {
    for (const point of trace.route) {
      if (point.route_type === "wire") expect(["top", "bottom"]).toContain(point.layer)
      if (point.route_type === "via") {
        expect(["top", "bottom"]).toContain(point.from_layer)
        expect(["top", "bottom"]).toContain(point.to_layer)
        expect(point.via_diameter).toBe(0.3)
        expect(point.via_hole_diameter).toBe(0.15)
        expect(Math.hypot(point.x + 3, point.y)).toBeGreaterThan(0.01)
        expect(Math.hypot(point.x - 3, point.y)).toBeGreaterThan(0.01)
      }
    }
  }
  expect(solver.pipeline9JointDrcRepairSolver!.stats.initialJointDrcIssueCount).toBe(0)
  expect(evaluateRelaxedDrc({
    inputSrj: input, srjWithPointPairs: solver.srjWithPointPairs!, routedTraces: traces,
    includeBoardClearance: true,
  }).errors).toEqual([])
  expect(solver.originalSrj.layerCount).toBe(4)
  expect(solver.originalSrj.obstacles.filter(obstacle => obstacle.isCopperPour).map(obstacle => obstacle.layers)).toEqual([["inner1"], ["inner2"]])
  expect(JSON.stringify(input)).toBe(original)
})
