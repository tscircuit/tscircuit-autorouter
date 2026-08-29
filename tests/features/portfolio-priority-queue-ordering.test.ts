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

  const solvableSolver = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "solvable-node",
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      availableZ: [0, 1],
      portPoints: [
        { connectionName: "a", x: -2, y: 0, z: 0 },
        { connectionName: "a", x: 2, y: 0, z: 0 },
      ],
    },
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    obstacles: [],
    layerCount: 2,
    effort: 1,
  })
  solvableSolver.solve()

  expect(solvableSolver.solved).toBe(true)
  expect(solvableSolver.getSupervisedSolverWithBestFitness()?.solver).toBe(
    solvableSolver.winningSolver,
  )
})
