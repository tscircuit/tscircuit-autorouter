import { expect, test } from "bun:test"
import { HyperParameterSupervisorSolver } from "lib/solvers/HyperParameterSupervisorSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("search candidates retain the original portfolio order without advancing", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "constructor-candidate-reuse",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      { x: -1, y: 0, z: 0, connectionName: "net1" },
      { x: 1, y: 0, z: 0, connectionName: "net1" },
    ],
  }
  const params = { nodeWithPortPoints, obstacles: [], layerCount: 2 }
  const eagerSolver = new PortfolioSingleIntraNodeSolver(params)
  HyperParameterSupervisorSolver.prototype.initializeSolvers.call(eagerSolver)
  const solver = new PortfolioSingleIntraNodeSolver(params)
  solver.initializeSolvers()

  expect(solver.supervisedSolvers!.map(({ hyperParameters }) => hyperParameters))
    .toEqual(eagerSolver.supervisedSolvers!.map(({ hyperParameters }) => hyperParameters))
  expect(solver.supervisedSolvers!.map(({ solver }) => solver.getSolverName()))
    .toEqual(eagerSolver.supervisedSolvers!.map(({ solver }) => solver.getSolverName()))
  expect(solver.supervisedSolvers!.every(({ solver }) => solver.iterations === 0))
    .toBe(true)
})
