import { expect, test } from "bun:test"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

const nodeWithPortPoints: NodeWithPortPoints = {
  capacityMeshNodeId: "future-via-node",
  center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0, 1, 2, 3],
  portPoints: [
    { connectionName: "a", x: -2, y: -1, z: 0 },
    { connectionName: "a", x: 2, y: 1, z: 3 },
    { connectionName: "b", x: -2, y: 1, z: 0 },
    { connectionName: "b", x: 2, y: -1, z: 3 },
  ],
}
const enabled = (solver: unknown): boolean =>
  (solver as { fixedFutureConnectionGeometry: boolean }).fixedFutureConnectionGeometry

test("only canonical owned portfolio candidates opt into fixed future geometry and propagate explicit false", () => {
  expect(enabled(new IntraNodeRouteSolver({ nodeWithPortPoints }))).toBe(false)
  const direct = new IntraNodeRouteSolver({ nodeWithPortPoints, fixedFutureConnectionGeometry: true })
  const owned = new PortfolioSingleIntraNodeSolver({ nodeWithPortPoints }).generateSolver({})
  expect(enabled(direct)).toBe(true)
  expect(enabled(owned)).toBe(true)
  const disabled = new PortfolioSingleIntraNodeSolver({ nodeWithPortPoints, fixedFutureConnectionGeometry: false }).generateSolver({})
  expect(enabled(disabled)).toBe(false)
  for (const method of ["getCombinationDefs", "getHyperParameterDefs", "getHyperParameterCombinations", "getSupervisedSolverWithBestFitness", "generateSolver"] as const) {
    const portfolio = new PortfolioSingleIntraNodeSolver({ nodeWithPortPoints })
    const original = portfolio[method].bind(portfolio)
    Object.defineProperty(portfolio, method, { value: original })
    expect(enabled(portfolio.generateSolver({}))).toBe(false)
    const prototype = PortfolioSingleIntraNodeSolver.prototype
    const descriptor = Object.getOwnPropertyDescriptor(prototype, method)
    const originalPrototypeMethod = prototype[method]
    Object.defineProperty(prototype, method, {
      configurable: true, writable: true,
      value: function (this: PortfolioSingleIntraNodeSolver, ...args: unknown[]): unknown {
        return Reflect.apply(originalPrototypeMethod, this, args)
      },
    })
    try {
      expect(enabled(new PortfolioSingleIntraNodeSolver({ nodeWithPortPoints }).generateSolver({}))).toBe(false)
    } finally {
      if (descriptor) Object.defineProperty(prototype, method, descriptor)
      else Reflect.deleteProperty(prototype, method)
    }
    const accessorPortfolio = new PortfolioSingleIntraNodeSolver({ nodeWithPortPoints })
    const originalAccessorMethod = accessorPortfolio[method]
    let reads = 0
    Object.defineProperty(accessorPortfolio, method, {
      configurable: true,
      get: (): typeof originalAccessorMethod => { reads++; return originalAccessorMethod },
    })
    expect(enabled(accessorPortfolio.generateSolver({}))).toBe(false)
    expect(reads).toBe(method === "generateSolver" ? 1 : 0)
  }
  for (const solver of [direct, owned, disabled]) {
    for (let steps = 0; steps < 10 && !solver.activeSubSolver; steps++) solver.step()
    expect(solver.activeSubSolver).not.toBeNull()
    expect(enabled(solver.activeSubSolver)).toBe(solver !== disabled)
  }
  const prototype = IntraNodeRouteSolver.prototype
  const method = "getSingleRouteSolverOpts"
  const descriptor = Object.getOwnPropertyDescriptor(prototype, method)!
  for (const accessor of [false, true]) {
    const original = descriptor.value
    const custom = function (this: IntraNodeRouteSolver, ...args: unknown[]): unknown {
      return Reflect.apply(original, this, args)
    }
    Object.defineProperty(prototype, method, accessor ? {
      configurable: true, get: (): typeof custom => custom,
    } : { configurable: true, writable: true, value: custom })
    try {
      const solver = new PortfolioSingleIntraNodeSolver({ nodeWithPortPoints }).generateSolver({})
      for (let steps = 0; steps < 10 && !solver.activeSubSolver; steps++) solver.step()
      expect(solver.activeSubSolver).not.toBeNull()
      expect(enabled(solver.activeSubSolver)).toBe(false)
    } finally {
      Object.defineProperty(prototype, method, descriptor)
    }
  }
})
