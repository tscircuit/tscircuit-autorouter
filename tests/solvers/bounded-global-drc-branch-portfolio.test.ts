import { expect, test } from "bun:test"
import { BoundedGlobalDrcBranchPortfolioSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/BoundedGlobalDrcBranchPortfolioSolver"
import type {
  GlobalDrcBranchPortfolioSolverParams,
  HighDensityRoute,
  SimpleRouteJson,
} from "high-density-repair03/lib"

const srj: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.1,
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  obstacles: [],
  connections: [],
}

function makeRoute(index: number, pointCount: number): HighDensityRoute {
  return {
    connectionName: `route_${index}`,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: Array.from({ length: pointCount }, (_, pointIndex) => ({
      x: pointIndex * 0.1,
      y: index * 0.1,
      z: 0,
    })),
  }
}

function makeParams(
  hdRoutes: HighDensityRoute[],
  drcEvaluator: GlobalDrcBranchPortfolioSolverParams["drcEvaluator"],
): GlobalDrcBranchPortfolioSolverParams {
  return {
    srj,
    hdRoutes,
    drcEvaluator,
    effort: 1,
    maxIterations: 32,
    broadMaxIterations: 8,
    broadPassMultiplier: 3,
    enableLargeBoardBroadFallback: false,
    enableTargetedErrorSweep: true,
    enablePostSolveClearanceRelaxation: false,
    enableViaInPadLayerMoves: false,
  }
}

test("skips impractical exact DRC work without changing small-board behavior", () => {
  const largeRoutes = Array.from({ length: 500 }, (_, index) =>
    makeRoute(index, 22),
  )
  let evaluationCount = 0
  const evaluateDrc = () => {
    evaluationCount += 1
    return { errors: [], errorsWithCenters: [] }
  }
  const largeSolver = new BoundedGlobalDrcBranchPortfolioSolver(
    makeParams(largeRoutes, evaluateDrc),
  )

  expect(largeSolver.skippedForLargeBoard).toBe(true)
  largeSolver.step()
  expect(largeSolver.solved).toBe(true)
  expect(largeSolver.getOutput()).toBe(largeRoutes)
  expect(evaluationCount).toBe(0)

  const smallSolver = new BoundedGlobalDrcBranchPortfolioSolver(
    makeParams([makeRoute(0, 2)], evaluateDrc),
  )
  expect(smallSolver.skippedForLargeBoard).toBe(false)
  smallSolver.step()
  expect(smallSolver.solved).toBe(true)
  expect(evaluationCount).toBe(1)
})
