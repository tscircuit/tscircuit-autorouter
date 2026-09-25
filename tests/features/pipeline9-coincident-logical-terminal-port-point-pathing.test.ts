import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 paths coincident logical terminals without requiring PCB port metadata", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "coincident",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pointId: "a" },
          { x: 0, y: 0, layer: "top", pointId: "b" },
        ],
      },
    ],
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.portPointPathingSolver!.solved).toBe(true)
  const pairs = solver
    .portPointPathingSolver!.getOutput()
    .nodesWithPortPoints.flatMap((node) => node.portPointsInPairs ?? [])
  expect(pairs).toHaveLength(1)
  expect(pairs[0][0].portPointId).not.toBe(pairs[0][1].portPointId)
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces).toHaveLength(1)
  expect(traces[0].connectsTo).toEqual(["a", "b"])
  expect(traces[0].route).toHaveLength(2)
})
