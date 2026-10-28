import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import type { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

class ThrowingSetupPortfolio extends PortfolioSingleIntraNodeSolver {
  override generateSolver(hyperParameters: Record<string, any>): IntraNodeRouteSolver {
    const candidate = super.generateSolver(hyperParameters)
    const external: unknown = candidate
    if (external instanceof HighDensitySolverA01) {
      external._setup = (): void => {
        throw new Error("Intentional A01 setup invariant for exception parity")
      }
    }
    return candidate
  }
}

test("an unrecognized throwing setup is exposed before a constructor-solved alternative can hide it", (): void => {
  const node: NodeWithPortPoints = { capacityMeshNodeId: "setup-exception-parity",
    center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0, 1],
    portPoints: [
      { connectionName: "A", x: -1, y: 0, z: 0 },
      { connectionName: "A", x: 1, y: 0, z: 1 },
    ] }
  for (const portfolioMode of ["eager", "lazy"] as const) {
    const portfolio = new ThrowingSetupPortfolio({ nodeWithPortPoints: node,
      traceWidth: 0.1, viaDiameter: 0.3, cacheProvider: null, portfolioMode })
    expect(() => portfolio.initializeSolvers()).toThrow("Intentional A01 setup invariant")
    expect(portfolio.supervisedSolvers!.some(({ solver }) =>
      solver.getSolverName() === "SingleTransitionIntraNodeSolver" && solver.solved)).toBe(true)
    expect(portfolio.solved).toBe(false)
  }
})
