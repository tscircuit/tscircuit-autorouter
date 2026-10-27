import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 activates connected-net attachment and preserves original multipoint connectivity", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -10, maxX: 10, minY: -8, maxY: 8 },
    obstacles: [{
      type: "rect", center: { x: 0, y: 0 }, width: 5, height: 5,
      layers: ["top", "bottom"], connectedTo: [],
    }],
    connections: [{ name: "tree", pointsToConnect: [
      { x: -8, y: -6, layer: "top", pointId: "a" },
      { x: 8, y: -6, layer: "top", pointId: "b" },
      { x: 8, y: 6, layer: "top", pointId: "c" },
      { x: -8, y: 6, layer: "top", pointId: "d" },
    ] }],
  }
  for (const point of input.connections[0]!.pointsToConnect) {
    const terminalId = `pcb_port_${point.pointId}`
    point.pcb_port_id = terminalId
    input.obstacles.push({
      type: "rect", center: { x: point.x, y: point.y }, width: 1, height: 1,
      layers: ["top"], connectedTo: ["tree", terminalId],
      circuitJsonMetadata: { pcb_port_id: terminalId, pcb_smtpad_id: `pad_${point.pointId}` },
    })
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(input), {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const metrics = solver.portPointPathingSolver?.getSolveGraphBenchmarkMetrics()
  expect(metrics?.connectedTreeRouteAttempts).toBeGreaterThan(0)
  expect(metrics?.connectedTreeExpandedGoalAttempts).toBeGreaterThan(0)
  expect(evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
    includeBoardClearance: true,
  }).errors).toEqual([])
})
