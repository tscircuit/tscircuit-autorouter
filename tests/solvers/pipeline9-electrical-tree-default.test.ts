import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"

test("default Pipeline9 exercises the electrical-tree solver and emits connected valid copper", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -6, maxX: 6, minY: -4, maxY: 4 },
    obstacles: [],
    connections: [{
      name: "bus",
      pointsToConnect: [
        { x: -4, y: 0, layer: "top", pcb_port_id: "start" },
        { x: 4, y: 0, layer: "top", pcb_port_id: "end" },
        { x: 0, y: 2, layer: "top", pcb_port_id: "branch" },
      ],
    }],
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, { cacheProvider: null })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.portPointPathingSolver!.getSolveGraphBenchmarkMetrics()!.electricalTreeTargetCount).toBeNumber()
  const output = solver.getOutputSimplifiedPcbTraces()
  expect(output.length).toBeGreaterThan(0)
  expect(evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: output,
  }).errors).toHaveLength(0)
})
