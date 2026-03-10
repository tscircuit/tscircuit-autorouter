import { expect, test } from "bun:test"
import missingPortPointsFixture from "../../fixtures/bug-reports/missing-port-points-001/missing-port-points-001.json"
import { AutoroutingPipelineSolver3_HgPortPointPathing } from "../../lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver3_HgPortPointPathing"
import { SingleTargetNecessaryCrampedPortPointSolver } from "../../lib/solvers/NecessaryCrampedPortPointSolver/SingleTargetNecessaryCrampedPortPointSolver"
import type { SimpleRouteJson } from "../../lib/types"

test("necessary cramped port point solver does not explode duplicate candidates", () => {
  const srj = missingPortPointsFixture as SimpleRouteJson
  const singleTargetStats: Array<{
    targetId: string
    candidateCount: number
    visitedCount: number
    ignoreCramped: boolean
  }> = []

  const originalStep =
    SingleTargetNecessaryCrampedPortPointSolver.prototype._step

  SingleTargetNecessaryCrampedPortPointSolver.prototype._step =
    function patchedStep() {
      originalStep.call(this)

      if (!this.solved) return

      singleTargetStats.push({
        // methods are private so need to convert to any
        targetId: (this as any).input.target.capacityMeshNodeId,
        candidateCount: (this as any).resultExploredPortPoints.length,
        visitedCount: (this as any).visitedExploredPortPoints.length,
        ignoreCramped: (this as any).input.shouldIgnoreCrampedPortPoints,
      })
    }

  const solver = new AutoroutingPipelineSolver3_HgPortPointPathing(srj)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(singleTargetStats.length).toBeGreaterThan(0)

  const maxCandidateCount = Math.max(
    ...singleTargetStats.map((stat) => stat.candidateCount),
  )
  const maxVisitedCount = Math.max(
    ...singleTargetStats.map((stat) => stat.visitedCount),
  )

  expect(maxCandidateCount).toBeLessThan(500)
  expect(maxVisitedCount).toBeLessThan(500)
  SingleTargetNecessaryCrampedPortPointSolver.prototype._step = originalStep
})
