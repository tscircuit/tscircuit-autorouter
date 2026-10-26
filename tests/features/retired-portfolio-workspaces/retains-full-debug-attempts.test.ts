import { expect, test } from "bun:test"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { makeNode } from "../never-fail-growth-high-density/test-helpers"

test("default and explicit debug modes retain complete failed portfolio instances", (): void => {
  for (const captureSearchDebug of [undefined, true]) {
    const params = { nodeWithPortPoints: makeNode(), captureSearchDebug }
    const grow = new GrowShrinkHighDensityIntraNodeSolver(params)
    const attempt = new PortfolioSingleIntraNodeSolver(params)
    const candidate = new IntraNodeRouteSolver(params)
    const supervised = [
      { hyperParameters: {}, solver: candidate, h: 2, g: 3, f: 4 },
    ]
    attempt.supervisedSolvers = supervised
    attempt.activeSubSolver = candidate
    attempt.failed = true
    attempt.error = "debug failure"
    grow.activeSubSolver = attempt

    grow.step()
    attempt.retireFailedCandidateWorkspaces()

    expect(grow.failedSolvers[0]).toBe(attempt)
    expect(attempt.supervisedSolvers).toBe(supervised)
    expect(attempt.activeSubSolver).toBe(candidate)
    expect(attempt.stats.failedCandidateWorkspacesRetired).toBeUndefined()
    expect(attempt.stats.retiredCandidateCount).toBeUndefined()
    expect(grow.scaleFactor).toBe(2)
  }
})
