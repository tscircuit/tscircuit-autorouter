import { expect, test } from "bun:test"
import { HyperParameterSupervisorSolver } from "lib/solvers/HyperParameterSupervisorSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("the first constructor winner keeps priority without creating search candidates", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "constructor-through-obstacle",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      { x: -0.2, y: 0, z: 0, connectionName: "net1" },
      { x: 0.2, y: 0, z: 1, connectionName: "net1" },
    ],
  }
  const obstacles: Obstacle[] = [
    {
      type: "rect",
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      layers: ["top", "bottom"],
      connectedTo: ["net1"],
    },
  ]
  const params = { nodeWithPortPoints, obstacles, layerCount: 2 }
  const eagerSolver = new PortfolioSingleIntraNodeSolver(params)
  HyperParameterSupervisorSolver.prototype.initializeSolvers.call(eagerSolver)
  eagerSolver.solve()

  const solver = new PortfolioSingleIntraNodeSolver(params)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.supervisedSolvers).toHaveLength(1)
  expect(solver.winningSolver!.getSolverName()).toBe(
    "SingleTransitionThroughObstacleIntraNodeSolver",
  )
  expect(solver.winningSolver!.getSolverName()).toBe(
    eagerSolver.winningSolver!.getSolverName(),
  )
  expect(solver.solvedRoutes).toEqual(eagerSolver.solvedRoutes)
  expect(solver.solvedRoutes[0]!.vias).toHaveLength(0)
  expect(solver.adaptiveSearchExpanded).toBe(false)
})
