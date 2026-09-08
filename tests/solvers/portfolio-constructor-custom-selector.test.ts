import { expect, test } from "bun:test"
import { HyperParameterSupervisorSolver } from "lib/solvers/HyperParameterSupervisorSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

class A03SelectedPortfolio extends PortfolioSingleIntraNodeSolver {
  override getSupervisedSolverWithBestFitness(): ReturnType<
    PortfolioSingleIntraNodeSolver["getSupervisedSolverWithBestFitness"]
  > {
    return (
      this.supervisedSolvers?.find(
        (candidate) =>
          candidate.hyperParameters.HIGH_DENSITY_A03 &&
          !candidate.solver.failed,
      ) ?? null
    )
  }
}

test("constructor preflight preserves a custom portfolio selector", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "custom-portfolio-selector",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      { x: -1, y: 0, z: 0, connectionName: "net1" },
      { x: 1, y: 0, z: 1, connectionName: "net1" },
    ],
  }
  const eager = new A03SelectedPortfolio({ nodeWithPortPoints })
  HyperParameterSupervisorSolver.prototype.initializeSolvers.call(eager)
  const solver = new A03SelectedPortfolio({ nodeWithPortPoints })
  solver.initializeSolvers()

  expect(
    solver.supervisedSolvers!.map(({ hyperParameters }) => hyperParameters),
  ).toEqual(
    eager.supervisedSolvers!.map(({ hyperParameters }) => hyperParameters),
  )
  const selected = solver.getSupervisedSolverWithBestFitness()
  expect(selected?.hyperParameters.HIGH_DENSITY_A03).toBe(true)
  expect(solver.supervisedSolvers!.some(({ solver }) => solver.solved)).toBe(
    true,
  )
  eager.solve()
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.winningSolver).toBe(selected!.solver)
  expect(solver.solvedRoutes).toEqual(eager.solvedRoutes)
  expect(solver.iterations).toBe(eager.iterations)
})
