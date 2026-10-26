import { expect, test } from "bun:test"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { makeNode } from "../never-fail-growth-high-density/test-helpers"

test("retirement rejects active and accepted portfolios before releasing any references", (): void => {
  for (const state of [
    { failed: false, solved: false },
    { failed: false, solved: true },
    { failed: true, solved: true },
  ]) {
    const params = { nodeWithPortPoints: makeNode(), captureSearchDebug: false }
    const attempt = new PortfolioSingleIntraNodeSolver(params)
    const candidate = new IntraNodeRouteSolver(params)
    const supervised = [
      { hyperParameters: {}, solver: candidate, h: 0, g: 0, f: 0 },
    ]
    attempt.supervisedSolvers = supervised
    attempt.activeSubSolver = candidate
    attempt.winningSolver = candidate
    attempt.failed = state.failed
    attempt.solved = state.solved

    expect((): void => attempt.retireFailedCandidateWorkspaces()).toThrow(
      "Only a failed portfolio can retire candidate workspaces",
    )
    expect(attempt.supervisedSolvers).toBe(supervised)
    expect(attempt.activeSubSolver).toBe(candidate)
    expect(attempt.winningSolver).toBe(candidate)
    expect(attempt.stats.failedCandidateWorkspacesRetired).toBeUndefined()
  }
})
