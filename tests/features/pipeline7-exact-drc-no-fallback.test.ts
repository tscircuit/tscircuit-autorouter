import { expect, test } from "bun:test"
import { GlobalDrcBranchPortfolioSolver } from "high-density-repair03/lib"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline7 disables speculative fallback inside its exact DRC portfolio", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.3,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [],
  }
  const solver = new AutoroutingPipelineSolver7_MultiGraph(srj, {
    cacheProvider: null,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.globalDrcForceImproveSolver).toBeDefined()
  expect(solver.globalDrcForceImproveSolver?.configuredMaxIterations).toBe(16)
  expect(
    solver.globalDrcForceImproveSolver?.enableLargeBoardBroadFallback,
  ).toBe(false)
  expect(solver.exactGeometryDrcForceImproveSolver).toBeInstanceOf(
    GlobalDrcBranchPortfolioSolver,
  )

  const exactSolver = solver.exactGeometryDrcForceImproveSolver
  expect(exactSolver?.params.maxIterations).toBe(32)
  expect(exactSolver?.params.drcEvaluator).toBeFunction()
  expect(exactSolver?.params.viaInPadDrcEvaluator).toBe(
    exactSolver?.params.drcEvaluator,
  )
  expect(exactSolver?.params.enableTargetedErrorSweep).toBe(true)
  expect(exactSolver?.params.enableLargeBoardBroadFallback).toBe(false)
  expect(exactSolver?.params.enableBroadFallback).toBe(false)
  expect(
    exactSolver?.params.enablePostSolveClearanceRelaxation,
  ).toBe(false)
  expect(exactSolver?.params.broadMaxIterations).toBe(12)
  expect(exactSolver?.params.broadPassMultiplier).toBe(3)
  expect(
    exactSolver?.stats.drcBranchPortfolioBroadInitialDrcIssueCount,
  ).toBeUndefined()
  expect(exactSolver?.stats.drcBranchPortfolioBroadBranchAttempted).toBe(false)
})
