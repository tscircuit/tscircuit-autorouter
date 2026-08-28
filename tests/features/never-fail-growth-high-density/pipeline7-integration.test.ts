import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"

test("Pipeline7 requires explicit opt-in for experimental high-density search", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    {
      layerCount: 4,
      minTraceWidth: 0.15,
      minViaPadDiameter: 0.3,
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
      obstacles: [],
      connections: [
        {
          name: "dense-low-net",
          pointsToConnect: Array.from({ length: 160 }, (_, index) => ({
            x: index / 10,
            y: 0,
            layer: "top",
          })),
        },
      ],
    } as any,
    {
      experimentalHighDensitySearchOptimization: true,
    },
  )

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
    (highDensityParams as any)
      .growShrinkTryLargestScaleAsRepairSeedAfterInitialFailure,
  ).toBe(true)
  expect(
    (highDensityParams as any)
      .prioritizeSolvedSegmentProgressBeforeAdaptiveExpansion,
  ).toBe(true)
  expect(
    (highDensityParams as any).includeSyntheticPortBoundsForExternalSolvers,
  ).toBe(true)
  expect(
    (highDensityParams as any).growShrinkMaxInnerIterationsPerGrowthAttempt,
  ).toBeUndefined()
  expect(
    (highDensityParams as any).growShrinkMaxInitialScaleSupervisorIterations,
  ).toBe(50_000)
  expect(
    (highDensityParams as any).growShrinkMaxTotalGrownScaleSupervisorIterations,
  ).toBe(25_000)
  expect((highDensityParams as any).captureSearchDebug).toBe(false)

  const ordinarySolver = new AutoroutingPipelineSolver7_MultiGraph({
    layerCount: 4,
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.3,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "ordinary-board",
        pointsToConnect: Array.from({ length: 160 }, (_, index) => ({
          x: index / 10,
          y: 0,
          layer: "top",
        })),
      },
    ],
  } as any)
  const ordinaryHighDensityStep = ordinarySolver.pipelineDef.find(
    (step) => step.solverName === "highDensityRouteSolver",
  )
  const [ordinaryHighDensityParams] =
    ordinaryHighDensityStep!.getConstructorParams({
      ...ordinarySolver,
      uniformPortDistributionSolver: { getOutput: () => [] } as any,
      portPointPathingSolver: {
        getOutput: () => ({
          nodesWithPortPoints: [],
          inputNodeWithPortPoints: [],
        }),
      } as any,
    } as any)

  expect(
    (ordinaryHighDensityParams as any)
      .growShrinkTryLargestScaleAsRepairSeedAfterInitialFailure,
  ).toBe(false)
  expect(
    (ordinaryHighDensityParams as any)
      .prioritizeSolvedSegmentProgressBeforeAdaptiveExpansion,
  ).toBe(false)
  expect(
    (ordinaryHighDensityParams as any)
      .includeSyntheticPortBoundsForExternalSolvers,
  ).toBe(false)
  expect(
    (ordinaryHighDensityParams as any)
      .growShrinkMaxInitialScaleSupervisorIterations,
  ).toBeUndefined()
  expect(
    (ordinaryHighDensityParams as any)
      .growShrinkMaxTotalGrownScaleSupervisorIterations,
  ).toBeUndefined()
})
