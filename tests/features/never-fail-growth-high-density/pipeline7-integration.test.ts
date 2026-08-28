import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"

test("Pipeline7 high-density stage opts into GrowShrinkHighDensityIntraNodeSolver", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph({
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.3,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [],
  } as any)

  const highDensityStep = solver.pipelineDef.find(
    (step) => step.solverName === "highDensityRouteSolver",
  )
  expect(highDensityStep).toBeDefined()
  const [highDensityParams] = highDensityStep!.getConstructorParams({
    ...solver,
    uniformPortDistributionSolver: { getOutput: () => [] } as any,
    portPointPathingSolver: {
      getOutput: () => ({
        nodesWithPortPoints: [],
        inputNodeWithPortPoints: [],
      }),
    } as any,
  } as any)

  expect(
    (highDensityParams as any).useGrowShrinkHighDensityIntraNodeSolver,
  ).toBe(true)
  expect(
    (highDensityParams as any).growShrinkFallbackToInvalidGeometryOnFailure,
  ).toBe(true)
  expect(
    (highDensityParams as any).growShrinkMaxInnerIterationsPerGrowthAttempt,
  ).toBeUndefined()
  expect((highDensityParams as any).enableHighDensityB02Solver).toBe(false)
  expect((highDensityParams as any).captureSearchDebug).toBe(false)
})
