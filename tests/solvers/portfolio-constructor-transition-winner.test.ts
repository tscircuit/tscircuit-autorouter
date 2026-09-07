import { expect, test } from "bun:test"
import { HyperParameterSupervisorSolver } from "lib/solvers/HyperParameterSupervisorSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("a closed-form constructor winner avoids search setup with identical routes", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "constructor-transition",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      { x: -1, y: -0.3, z: 0, connectionName: "net1" },
      { x: 1, y: 0.3, z: 1, connectionName: "net1" },
    ],
  }
  const params = { nodeWithPortPoints, obstacles: [], layerCount: 2 }
  const eagerSolver = new PortfolioSingleIntraNodeSolver(params)
  HyperParameterSupervisorSolver.prototype.initializeSolvers.call(eagerSolver)
  eagerSolver.solve()

  const solver = new PortfolioSingleIntraNodeSolver(params)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.supervisedSolvers).toHaveLength(2)
  expect(solver.winningSolver!.getSolverName()).toBe(
    "SingleTransitionIntraNodeSolver",
  )
  expect(solver.winningSolver!.getSolverName()).toBe(
    eagerSolver.winningSolver!.getSolverName(),
  )
  expect(solver.solvedRoutes).toEqual(eagerSolver.solvedRoutes)
  expect(solver.iterations).toBe(eagerSolver.iterations)
  expect(solver.adaptiveSearchExpanded).toBe(false)
})
