import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { SimpleRouteJson } from "lib/types"

const makeSrj = (defaultObstacleMargin: number): SimpleRouteJson => ({
  layerCount: 2,
  minTraceWidth: 0.15,
  defaultObstacleMargin,
  obstacles: [],
  connections: [
    {
      name: "c1",
      pointsToConnect: [
        { x: -1, y: 0, layer: "top" },
        { x: 1, y: 0, layer: "top" },
      ],
    },
  ],
  bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
})

// The segment point spacing is traceWidth + obstacleMargin, so it is the stage
// that sets how far apart different-net traces sit where they cross capacity
// mesh node boundaries. Pipeline 4 must hand the srj margin to it, otherwise the
// spacing is pinned to the solver default and the configured margin has no
// effect on the produced clearance (issue #1523).
test("availableSegmentPointSolver receives defaultObstacleMargin from the srj", () => {
  const margin = 0.3
  const solver = new AutoroutingPipelineSolver4(makeSrj(margin))

  const step = solver.pipelineDef.find(
    (pipelineStep) => pipelineStep.solverName === "availableSegmentPointSolver",
  )
  expect(step).toBeDefined()

  const params = step!.getConstructorParams(solver)[0] as {
    obstacleMargin?: number
  }
  expect(params.obstacleMargin).toBe(margin)
})
