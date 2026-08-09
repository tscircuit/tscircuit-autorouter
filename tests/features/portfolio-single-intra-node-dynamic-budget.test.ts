import { expect, test } from "bun:test"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

const TEST_NODE: NodeWithPortPoints = {
  capacityMeshNodeId: "dynamic-budget-test-node",
  center: { x: 0, y: 0 },
  width: 1,
  height: 1,
  portPoints: [
    { connectionName: "test-route", x: -0.4, y: 0, z: 0 },
    { connectionName: "test-route", x: 0.4, y: 0, z: 0 },
  ],
}

class DeadlineExtendingIntraNodeSolver extends IntraNodeRouteSolver {
  constructor() {
    super({ nodeWithPortPoints: TEST_NODE })
    this.MAX_ITERATIONS = 1
  }

  override _step(): void {
    this.MAX_ITERATIONS = 1_000
  }
}

class DynamicBudgetPortfolioSolver extends PortfolioSingleIntraNodeSolver {
  candidate = new DeadlineExtendingIntraNodeSolver()

  constructor() {
    super({ nodeWithPortPoints: TEST_NODE })
    this.MIN_SUBSTEPS = 1
  }

  override initializeSolvers(): void {
    this.supervisedSolvers = [
      {
        hyperParameters: {},
        solver: this.candidate,
        h: 0,
        g: 0,
        f: 0,
      },
    ]
    this.MAX_ITERATIONS = 1
  }
}

test("portfolio follows a child solver's extended iteration deadline", () => {
  const portfolioSolver = new DynamicBudgetPortfolioSolver()
  portfolioSolver.initializeSolvers()
  const initialPortfolioDeadline = portfolioSolver.MAX_ITERATIONS

  portfolioSolver.step()

  expect(portfolioSolver.candidate.MAX_ITERATIONS).toBe(1_000)
  expect(portfolioSolver.MAX_ITERATIONS).toBeGreaterThan(
    initialPortfolioDeadline,
  )
  expect(portfolioSolver.failed).toBe(false)
})
