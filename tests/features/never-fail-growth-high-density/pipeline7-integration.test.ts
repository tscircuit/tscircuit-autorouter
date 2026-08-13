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
})

test("Pipeline7 uses a DRC-validated fast probe for two-layer exact repair", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph({
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.3,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [],
  } as any)

  const globalDrcStep = solver.pipelineDef.find(
    (step) => step.solverName === "globalDrcForceImproveSolver",
  )
  expect(globalDrcStep).toBeDefined()
  const [globalDrcParams] = globalDrcStep!.getConstructorParams({
    ...solver,
    srjWithPointPairs: solver.srj,
    traceWidthSolver: { getHdRoutesWithWidths: () => [] },
  } as any)
  expect((globalDrcParams as any).maxIterations).toBe(16)
  expect((globalDrcParams as any).enableLargeBoardBroadFallback).toBe(false)

  const exactGeometryDrcStep = solver.pipelineDef.find(
    (step) => step.solverName === "exactGeometryDrcForceImproveSolver",
  )
  expect(exactGeometryDrcStep).toBeDefined()
  const [exactGeometryDrcParams] = exactGeometryDrcStep!.getConstructorParams({
    ...solver,
    srjWithPointPairs: solver.srj,
    globalDrcForceImproveSolver: { getOutput: () => [] },
    netToPointPairsSolver: { newConnections: [] },
  } as any)
  expect((exactGeometryDrcParams as any).maxIterations).toBe(32)
  expect((exactGeometryDrcParams as any).drcEvaluator).toBeFunction()
  expect((exactGeometryDrcParams as any).viaInPadDrcEvaluator).toBe(
    (exactGeometryDrcParams as any).drcEvaluator,
  )
  expect((exactGeometryDrcParams as any).enableTargetedErrorSweep).toBe(true)
  expect((exactGeometryDrcParams as any).enableLargeBoardBroadFallback).toBe(
    false,
  )
  expect(
    (exactGeometryDrcParams as any).enablePostSolveClearanceRelaxation,
  ).toBe(false)
  expect((exactGeometryDrcParams as any).broadMaxIterations).toBe(12)
  expect((exactGeometryDrcParams as any).broadPassMultiplier).toBe(3)

  const adaptiveTwoLayerSolver = new exactGeometryDrcStep!.solverClass(
    exactGeometryDrcParams as any,
  )
  adaptiveTwoLayerSolver.solve()
  expect(
    adaptiveTwoLayerSolver.stats.pipeline7AdaptiveExactDrcFastProbeAttempted,
  ).toBe(true)
  expect(
    adaptiveTwoLayerSolver.stats.pipeline7AdaptiveExactDrcFastProbeAccepted,
  ).toBe(true)

  const fourLayerSrj = { ...solver.srj, layerCount: 4 }
  const [fourLayerExactGeometryDrcParams] =
    exactGeometryDrcStep!.getConstructorParams({
      ...solver,
      srj: fourLayerSrj,
      originalSrj: {
        ...solver.originalSrj,
        layerCount: 4,
      },
      srjWithPointPairs: fourLayerSrj,
      globalDrcForceImproveSolver: { getOutput: () => [] },
      netToPointPairsSolver: { newConnections: [] },
    } as any)
  const fourLayerSolver = new exactGeometryDrcStep!.solverClass(
    fourLayerExactGeometryDrcParams as any,
  )
  fourLayerSolver.solve()
  expect(
    fourLayerSolver.stats.pipeline7AdaptiveExactDrcFastProbeAttempted,
  ).toBe(false)
  expect(fourLayerSolver.stats.pipeline7AdaptiveExactDrcFastProbeAccepted).toBe(
    false,
  )
})
