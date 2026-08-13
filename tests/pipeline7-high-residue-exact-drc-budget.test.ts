import { expect, test } from "bun:test"
import { Pipeline7ExactDrcBranchPortfolioSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/Pipeline7ExactDrcBranchPortfolioSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline7 skips broad exact-DRC branches for a high initial residue", () => {
  const hdRoutes: HighDensityRoute[] = []
  const solver = new Pipeline7ExactDrcBranchPortfolioSolver({
    srj: {
      layerCount: 2,
      minTraceWidth: 0.15,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      obstacles: [],
      connections: [],
    },
    hdRoutes,
    maxIterations: 1,
    broadMaxIterations: 1,
    broadPassMultiplier: 3,
    skipExpensiveBranches: true,
    inputDrcIssueCount: 652,
  })

  solver.step()

  expect(solver.solved).toBe(true)
  expect(solver.getOutput()).toBe(hdRoutes)
  expect(solver.stats).toEqual({
    exactDrcBranchPortfolioSkipped: true,
    exactDrcBranchPortfolioSkipReason: "high_initial_drc_issue_count",
    exactDrcBranchPortfolioInitialDrcIssueCount: 652,
  })
})
