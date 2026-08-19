import { expect, test } from "bun:test"
import { GlobalDrcBranchPortfolioSolver } from "high-density-repair03/lib"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"

test("Pipeline7 runs one exact DRC portfolio with broad fallback disabled", () => {
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
  expect(exactGeometryDrcStep!.solverClass).toBe(GlobalDrcBranchPortfolioSolver)
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
  expect((exactGeometryDrcParams as any).enableBroadFallback).toBe(false)
  expect(
    (exactGeometryDrcParams as any).enablePostSolveClearanceRelaxation,
  ).toBe(false)
  expect((exactGeometryDrcParams as any).broadMaxIterations).toBeUndefined()
  expect((exactGeometryDrcParams as any).broadPassMultiplier).toBeUndefined()

  const exactSolver = new GlobalDrcBranchPortfolioSolver(
    exactGeometryDrcParams as any,
  )
  exactSolver.solve()
  expect(exactSolver.solved).toBe(true)
  expect(exactSolver.failed).toBe(false)
  expect(
    exactSolver.stats.drcBranchPortfolioBroadInitialDrcIssueCount,
  ).toBeUndefined()
  expect(exactSolver.stats.drcBranchPortfolioBroadBranchAttempted).toBe(false)
})
