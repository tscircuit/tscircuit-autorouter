import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"

test("Pipeline7 rejects multipoint differential pairs before topology planning", (): void => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph({
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -10, maxX: 10, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [
      {
        name: "positive",
        pointsToConnect: [
          { x: -8, y: 1, layer: "top" },
          { x: 0, y: 1, layer: "top" },
          { x: 8, y: 1, layer: "top" },
        ],
      },
      {
        name: "negative",
        pointsToConnect: [
          { x: -8, y: -1, layer: "top" },
          { x: 0, y: -1, layer: "top" },
          { x: 8, y: -1, layer: "top" },
        ],
      },
    ],
    differentialPairs: [
      { connectionNames: ["positive", "negative"], lengthTolerance: 0.15 },
    ],
  })

  solver.solve()

  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.error).toBe(
    'Differential pair connection "positive" resolves to 2 point-pair connections; exactly one is supported. Declare each constrained point-to-point segment as a separate differential pair.',
  )
  expect(solver.netToPointPairsSolver?.newConnections).toHaveLength(4)
  expect(solver.topologyPlanningSolver).toBeUndefined()
})
