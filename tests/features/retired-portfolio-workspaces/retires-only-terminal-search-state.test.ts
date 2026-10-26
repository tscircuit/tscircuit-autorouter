import { expect, test } from "bun:test"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { makeNode } from "../never-fail-growth-high-density/test-helpers"

test("non-debug growth retires a terminal portfolio without changing attempt metadata", (): void => {
  const node = makeNode()
  const params = { nodeWithPortPoints: node, captureSearchDebug: false }
  const grow = new GrowShrinkHighDensityIntraNodeSolver(params)
  const attempt = new PortfolioSingleIntraNodeSolver(params)
  const candidate = new IntraNodeRouteSolver(params)
  const workspace = new Float64Array(128)
  candidate.stats.workspace = workspace
  attempt.supervisedSolvers = [
    { hyperParameters: {}, solver: candidate, h: 2, g: 3, f: 4 },
  ]
  attempt.activeSubSolver = candidate
  attempt.failed = true
  attempt.error = "terminal search exhaustion"
  attempt.iterations = 17
  attempt.MAX_ITERATIONS = 21
  attempt.progress = 0.45
  attempt.stats.originalMetric = 27
  grow.activeSubSolver = attempt

  grow.step()

  expect(grow.failedSolvers).toEqual([attempt])
  expect(grow.error).toBe("terminal search exhaustion")
  expect(grow.scaleFactor).toBe(2)
  expect(grow.growthAttempts).toBe(1)
  expect(grow.activeSubSolver).toBeNull()
  expect(attempt.nodeWithPortPoints).toBe(node)
  expect(attempt.error).toBe("terminal search exhaustion")
  expect(attempt.iterations).toBe(17)
  expect(attempt.MAX_ITERATIONS).toBe(21)
  expect(attempt.progress).toBe(0.45)
  expect(attempt.stats.originalMetric).toBe(27)
  expect(attempt.stats.retiredCandidateCount).toBe(1)
  expect(attempt.stats.failedCandidateWorkspacesRetired).toBe(true)
  expect(attempt.supervisedSolvers).toEqual([])
  expect(attempt.activeSubSolver).toBeNull()
  expect(candidate.stats.workspace).toBe(workspace)
  expect(workspace.byteLength).toBe(1024)
  expect(attempt.failed).toBe(true)
  expect(attempt.solved).toBe(false)
})
