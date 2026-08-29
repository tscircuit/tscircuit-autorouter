import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import sample002LargeNode from "../fixtures/srj18-sample002-large-node.json"

test("the portfolio priority queue preserves legacy fitness ordering", () => {
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

  const getLegacyBestCandidate = () => {
    let bestFitness = Infinity
    let bestCandidate:
      | NonNullable<typeof solver.supervisedSolvers>[number]
      | null = null
    for (const candidate of solver.supervisedSolvers ?? []) {
      if (candidate.solver.solved) return candidate
      if (candidate.solver.failed) continue
      if (candidate.f < bestFitness) {
        bestFitness = candidate.f
        bestCandidate = candidate
      }
    }
    return bestCandidate
  }

  for (let step = 0; step < 100 && !solver.solved && !solver.failed; step++) {
    expect(solver.getSupervisedSolverWithBestFitness()).toBe(
      getLegacyBestCandidate(),
    )
    solver.step()
  }

  expect(solver.iterations).toBeGreaterThan(10)
  expect(Number(solver.stats.priorityQueueComparisonCount ?? 0)).toBeGreaterThan(
    0,
  )
})
