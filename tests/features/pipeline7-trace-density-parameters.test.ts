import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"

const getPortPointPathingParams = (defaultObstacleMargin?: number) => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph({
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.3,
    defaultObstacleMargin,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [],
  })
  const portPointPathingStep = solver.pipelineDef.find(
    (step) => step.solverName === "portPointPathingSolver",
  )
  if (!portPointPathingStep) {
    throw new Error("Pipeline7 is missing the portPointPathingSolver stage")
  }

  const [params] = portPointPathingStep.getConstructorParams({
    ...solver,
    capacityNodes: [],
    srjWithPointPairs: solver.srj,
    availableSegmentPointSolver: { getOutput: () => [] },
  } as AutoroutingPipelineSolver7_MultiGraph)
  return params
}

test("Pipeline7 passes trace density dimensions to tiny-hypergraph", () => {
  const explicitClearanceParams = getPortPointPathingParams(0.22)
  expect(explicitClearanceParams.minTraceWidth).toBe(0.15)
  expect(explicitClearanceParams.minTraceClearance).toBe(0.22)

  const defaultClearanceParams = getPortPointPathingParams()
  expect(defaultClearanceParams.minTraceWidth).toBe(0.15)
  expect(defaultClearanceParams.minTraceClearance).toBeUndefined()
})
