import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import sample002LargeNode from "../fixtures/srj18-sample002-large-node.json"

test("the portfolio tracks a child's live iteration-budget increase", () => {
  const solver = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: sample002LargeNode as NodeWithPortPoints,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    obstacles: [],
    layerCount: 2,
    effort: 1,
  })
  solver.initializeSolvers()
  const activeCandidate = solver.supervisedSolvers!.find(
    ({ solver: candidate }) =>
      candidate.getSolverName() === "HighDensitySolverA01",
  )!.solver
  for (const { solver: candidate } of solver.supervisedSolvers!) {
    if (candidate !== activeCandidate) candidate.failed = true
  }
  const initialSupervisorLimit = solver.MAX_ITERATIONS
  const increasedCandidateLimit =
    activeCandidate.MAX_ITERATIONS +
    initialSupervisorLimit * solver.MIN_SUBSTEPS
  let candidateStepCount = 0
  ;(activeCandidate as any).step = () => {
    candidateStepCount++
    activeCandidate.iterations++
    activeCandidate.MAX_ITERATIONS = increasedCandidateLimit
  }

  solver.step()

  expect(candidateStepCount).toBe(solver.MIN_SUBSTEPS)
  expect(activeCandidate.MAX_ITERATIONS).toBe(increasedCandidateLimit)
  expect(solver.MAX_ITERATIONS).toBeGreaterThan(initialSupervisorLimit)
  expect(solver.stats.dynamicSupervisorIterationLimit).toBe(
    solver.MAX_ITERATIONS,
  )
})
