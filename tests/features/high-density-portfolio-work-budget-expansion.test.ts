import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import sample002LargeNode from "../fixtures/srj18-sample002-large-node.json"

test("the portfolio expands after its dynamically sized work budget", () => {
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
  activeCandidate.iterations = solver.stats.dynamicExpansionWorkBudget
  ;(activeCandidate as any).step = () => {
    activeCandidate.iterations++
  }

  expect(solver.stats.dynamicExpansionWorkBudget).toBe(
    Math.max(
      ...solver.supervisedSolvers!
        .filter(({ f }) => Number.isFinite(f))
        .map(({ solver: candidate }) => candidate.MAX_ITERATIONS),
    ),
  )

  solver.step()

  expect(solver.adaptiveSearchExpanded).toBe(true)
  expect(solver.stats.adaptiveSearchExpandedAtIteration).toBe(1)
  expect(solver.stats.dynamicExpansionWorkBudget).toBeGreaterThan(0)
})
