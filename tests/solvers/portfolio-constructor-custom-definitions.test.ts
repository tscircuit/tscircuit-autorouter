import { expect, test } from "bun:test"
import { HyperParameterSupervisorSolver } from "lib/solvers/HyperParameterSupervisorSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

class GridOnlyPortfolio extends PortfolioSingleIntraNodeSolver {
  override getCombinationDefs(): string[][] {
    const definitions = super.getCombinationDefs()
    return definitions.filter((definition) =>
      definition.includes("highDensityA01"),
    )
  }
}

class NoClosedFormPortfolio extends PortfolioSingleIntraNodeSolver {
  override getHyperParameterDefs(): ReturnType<PortfolioSingleIntraNodeSolver["getHyperParameterDefs"]> {
    return super.getHyperParameterDefs().map((definition) =>
      definition.name === "closedFormSingleTrace"
        ? { ...definition, possibleValues: [] }
        : definition,
    )
  }
}

test("constructor preflight respects customized portfolio definitions", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "custom-portfolio-definitions",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      { x: -1, y: 0, z: 0, connectionName: "net1" },
      { x: 1, y: 0, z: 1, connectionName: "net1" },
    ],
  }
  for (const Solver of [GridOnlyPortfolio, NoClosedFormPortfolio]) {
    const eagerSolver = new Solver({ nodeWithPortPoints })
    HyperParameterSupervisorSolver.prototype.initializeSolvers.call(eagerSolver)
    const solver = new Solver({ nodeWithPortPoints })
    solver.initializeSolvers()

    expect(solver.supervisedSolvers!.map(({ hyperParameters }) => hyperParameters))
      .toEqual(eagerSolver.supervisedSolvers!.map(({ hyperParameters }) => hyperParameters))
    expect(solver.supervisedSolvers!.some(({ solver }) => solver.solved)).toBe(false)
    expect(solver.supervisedSolvers!.every(({ solver }) => solver.iterations === 0))
      .toBe(true)
  }
})
