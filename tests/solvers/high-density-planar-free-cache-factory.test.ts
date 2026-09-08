import { expect, test } from "bun:test"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

const nodeWithPortPoints: NodeWithPortPoints = {
  capacityMeshNodeId: "node", center: { x: 0, y: 0 }, width: 4, height: 4,
  portPoints: [
    { connectionName: "a", x: -2, y: -1, z: 0 },
    { connectionName: "a", x: 2, y: 1, z: 1 },
    { connectionName: "b", x: -2, y: 1, z: 0 },
    { connectionName: "b", x: 2, y: -1, z: 1 },
  ],
}
const enabled = (solver: IntraNodeRouteSolver): boolean =>
  (solver as unknown as { fixedObstacleGeometry: boolean }).fixedObstacleGeometry

test("only canonical portfolio-owned candidates enable the fixed obstacle geometry contract", () => {
  expect(enabled(new IntraNodeRouteSolver({ nodeWithPortPoints }))).toBe(false)
  const direct = new IntraNodeRouteSolver({ nodeWithPortPoints, fixedObstacleGeometry: true })
  expect(enabled(direct)).toBe(true)
  const owned = new PortfolioSingleIntraNodeSolver({ nodeWithPortPoints }).generateSolver({})
  expect(enabled(owned)).toBe(true)
  const explicitlyDisabled = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints, fixedObstacleGeometry: false,
  }).generateSolver({})
  expect(enabled(explicitlyDisabled)).toBe(false)
  for (const method of ["getCombinationDefs", "getHyperParameterDefs", "getHyperParameterCombinations", "getSupervisedSolverWithBestFitness", "generateSolver"] as const) {
    const portfolio = new PortfolioSingleIntraNodeSolver({ nodeWithPortPoints })
    const original = portfolio[method].bind(portfolio)
    Object.defineProperty(portfolio, method, { value: original })
    expect(enabled(portfolio.generateSolver({}))).toBe(false)
  }
  for (const method of ["getCombinationDefs", "getHyperParameterDefs", "getHyperParameterCombinations", "getSupervisedSolverWithBestFitness", "generateSolver"] as const) {
    const prototype = PortfolioSingleIntraNodeSolver.prototype
    const descriptor = Object.getOwnPropertyDescriptor(prototype, method)
    const original = prototype[method] as (...args: unknown[]) => unknown
    Object.defineProperty(prototype, method, {
      configurable: true, writable: true,
      value: function (this: PortfolioSingleIntraNodeSolver, ...args: unknown[]): unknown {
        return original.apply(this, args)
      },
    })
    try {
      const customized = new PortfolioSingleIntraNodeSolver({ nodeWithPortPoints })
      expect(enabled(customized.generateSolver({}))).toBe(false)
    } finally {
      if (descriptor) Object.defineProperty(prototype, method, descriptor)
      else Reflect.deleteProperty(prototype, method)
    }
  }
  for (const solver of [direct, owned]) {
    for (let steps = 0; steps < 10 && !solver.activeSubSolver; steps++) solver.step()
    expect(solver.activeSubSolver).not.toBeNull()
    expect((solver.activeSubSolver as unknown as { fixedObstacleGeometry: boolean }).fixedObstacleGeometry).toBe(true)
  }
})
