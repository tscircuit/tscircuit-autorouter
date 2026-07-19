import { expect, test } from "bun:test"
import { GlobalDrcBranchPortfolioSolver } from "high-density-repair03/lib"
import { getMaxTargetedCandidateAttemptsForEffort } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"

test("Pipeline7 spends high effort on bounded exact DRC portfolios", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    {
      layerCount: 2,
      minTraceWidth: 0.15,
      minViaPadDiameter: 0.3,
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
      obstacles: [],
      connections: [],
    } as any,
    { effort: 100 },
  )
  const exactDrcStep = solver.pipelineDef.find(
    (step) => step.solverName === "exactGeometryDrcForceImproveSolver",
  )!
  const [exactDrcParams] = exactDrcStep.getConstructorParams({
    ...solver,
    srjWithPointPairs: solver.srj,
    globalDrcForceImproveSolver: { getOutput: () => [] },
    traceWidthSolver: { getHdRoutesWithWidths: () => [] },
    netToPointPairsSolver: { newConnections: [] },
  } as any)

  expect((exactDrcParams as any).maxIterations).toBe(3_200)
  expect((exactDrcParams as any).viaInPadMaxIterations).toBe(3_200)
  expect((exactDrcParams as any).broadMaxIterations).toBe(800)
  expect((exactDrcParams as any).baselineMaxIterations).toBe(32)
  expect((exactDrcParams as any).baselineBroadMaxIterations).toBe(8)

  const portfolio = new GlobalDrcBranchPortfolioSolver(exactDrcParams as any)
  expect(portfolio.branchStrategies).toHaveLength(10)
  expect(portfolio.branchStrategies[0]).toMatchObject({
    name: "baseline",
    solverEffort: 1,
    maxIterations: 32,
  })
  expect(portfolio.maxConsecutiveNonImprovingBranches).toBe(4)
  expect(getMaxTargetedCandidateAttemptsForEffort(100)).toBe(
    getMaxTargetedCandidateAttemptsForEffort(1),
  )
})
