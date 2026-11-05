import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import type { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

class CallbackGridPortfolio extends PortfolioSingleIntraNodeSolver {
  override generateSolver(hyperParameters: Record<string, any>): IntraNodeRouteSolver {
    const candidate = super.generateSolver(hyperParameters)
    const external: unknown = candidate
    if (external instanceof HighDensitySolverA01) {
      external.initialPenaltyFn = (): number => {
        throw new Error("User penalty callback setup error")
      }
    }
    return candidate
  }
}

test("custom penalty callbacks execute eagerly and their exceptions cannot be hidden by lazy allocation", (): void => {
  const node: NodeWithPortPoints = { capacityMeshNodeId: "callback-exception-contract",
    center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0, 1],
    portPoints: [
      { connectionName: "A", x: -1, y: 0, z: 0 },
      { connectionName: "A", x: 1, y: 0, z: 1 },
    ] }
  for (const portfolioMode of ["eager", "lazy"] as const) {
    const portfolio = new CallbackGridPortfolio({ nodeWithPortPoints: node, traceWidth: 0.1,
      viaDiameter: 0.3, cacheProvider: null, portfolioMode })
    expect(() => portfolio.initializeSolvers()).toThrow("User penalty callback setup error")
    expect(portfolio.solved).toBe(false)
  }
})
