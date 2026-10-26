import { expect, test } from "bun:test"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { makeNode } from "../never-fail-growth-high-density/test-helpers"

test("repeated retirement retains original candidate counts and terminal error", (): void => {
  const params = { nodeWithPortPoints: makeNode(), captureSearchDebug: false }
  const attempt = new PortfolioSingleIntraNodeSolver(params)
  const candidate = new IntraNodeRouteSolver(params)
  attempt.supervisedSolvers = [
    { hyperParameters: {}, solver: candidate, h: 0, g: 0, f: 0 },
  ]
  attempt.failed = true
  attempt.error = "already exhausted"

  attempt.retireFailedCandidateWorkspaces()
  attempt.retireFailedCandidateWorkspaces()
  attempt.step()

  expect(attempt.stats.retiredCandidateCount).toBe(1)
  expect(attempt.stats.failedCandidateWorkspacesRetired).toBe(true)
  expect(attempt.error).toBe("already exhausted")
  expect(attempt.iterations).toBe(0)
  expect(attempt.failed).toBe(true)
  expect(attempt.solved).toBe(false)
  expect(attempt.supervisedSolvers).toEqual([])
})
