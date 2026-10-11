import { expect, spyOn, test } from "bun:test"
import type { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { SingleTransitionThroughObstacleIntraNodeSolver } from "lib/solvers/HighDensitySolver/SingleTransitionThroughObstacleIntraNodeSolver"
import { HyperParameterSupervisorSolver } from "lib/solvers/HyperParameterSupervisorSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { areNodePortPointPairsConnectedByRoutes } from "lib/solvers/HyperHighDensitySolver/repairDisconnectedSameRootPortPoints"
import type { Obstacle } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

class CountingPortfolio extends PortfolioSingleIntraNodeSolver {
  generatedParameters: Array<Record<string, unknown>> = []

  override generateSolver(
    hyperParameters: Record<string, unknown>,
  ): IntraNodeRouteSolver {
    this.generatedParameters.push(hyperParameters)
    return super.generateSolver(hyperParameters)
  }
}

test("constructor-solved through-obstacle routes retain the earliest winner without later initialization", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "constructor-solved-through-obstacle",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      {
        connectionName: "A",
        rootConnectionName: "rootA",
        x: -0.25,
        y: 0,
        z: 0,
      },
      { connectionName: "A", rootConnectionName: "rootA", x: 0.25, y: 0, z: 1 },
    ],
  }
  const obstacles: Obstacle[] = [
    {
      type: "rect",
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      layers: ["top", "bottom"],
      connectedTo: ["A"],
      circuitJsonMetadata: { pcb_port_id: "pcb_port_A" },
    },
  ]
  const params = { nodeWithPortPoints: node, obstacles, layerCount: 2 }
  const reference = new CountingPortfolio(params)
  // The default supervisor still constructs the complete original portfolio.
  HyperParameterSupervisorSolver.prototype.initializeSolvers.call(reference)
  expect(reference.generatedParameters.length).toBeGreaterThan(1)
  expect(
    reference.supervisedSolvers!.filter(({ solver }) => solver.solved).length,
  ).toBeGreaterThan(1)
  const originalWinner = reference.getSupervisedSolverWithBestFitness()!.solver
  expect(originalWinner).toBeInstanceOf(
    SingleTransitionThroughObstacleIntraNodeSolver,
  )
  reference.solve()

  const portfolio = new CountingPortfolio(params)
  const budgetSetup = spyOn(
    portfolio as unknown as {
      initializeCandidateBudget(solver: unknown): void
    },
    "initializeCandidateBudget",
  )
  try {
    portfolio.solve()
    expect(portfolio.generatedParameters).toEqual([{ THROUGH_OBSTACLE: true }])
    expect(budgetSetup).not.toHaveBeenCalled()
    expect(portfolio.solved).toBe(true)
    expect(portfolio.failed).toBe(false)
    expect(portfolio.winningSolver).toBe(
      portfolio.supervisedSolvers![0]!.solver,
    )
    expect(portfolio.winningSolver).toBeInstanceOf(
      SingleTransitionThroughObstacleIntraNodeSolver,
    )
    expect(portfolio.solvedRoutes).toEqual(reference.solvedRoutes)
    expect(portfolio.solvedRoutes[0]!.route[0]!.toNextSegmentType).toBe(
      "through_obstacle",
    )
    expect(
      areNodePortPointPairsConnectedByRoutes(portfolio.solvedRoutes, node),
    ).toBe(true)
  } finally {
    budgetSetup.mockRestore()
  }
})
