import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../../lib/types"

test("Pipeline9 completes a coupled pair without postprocessing errors", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -10, maxX: 10, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [-0.175, 0.175].map((y, index) => ({
      name: `pair_${index}`,
      pointsToConnect: [
        { x: -8, y, layer: "top" },
        { x: 8, y, layer: "top" },
      ],
    })),
    differentialPairs: [{
      connectionNames: ["pair_0", "pair_1"],
      lengthTolerance: 0.05,
      traceGap: 0.2,
      maxUncoupledLength: 1,
    }],
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input)
  solver.solve()
  expect(solver.postProcessingErrors).toEqual([])
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.lengthMatchingPostProcessingSolver?.postProcessingErrors).toEqual([])
  expect(solver.getOutputSimplifiedPcbTraces()).toHaveLength(2)
})
