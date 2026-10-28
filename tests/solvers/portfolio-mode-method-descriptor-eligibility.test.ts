import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import type { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { policySnapshot } from "./lazyPortfolioTestUtils"

type MethodCase = "setup-readonly" | "getOutput-readonly" | "setup-accessor" | "getOutput-accessor"
type Params = ConstructorParameters<typeof PortfolioSingleIntraNodeSolver>[0]

class FixedMethodPortfolio extends PortfolioSingleIntraNodeSolver {
  getterReads = 0

  constructor(params: Params, private readonly methodCase: MethodCase) {
    super(params)
  }

  override generateSolver(hyperParameters: Record<string, any>): IntraNodeRouteSolver {
    const candidate = super.generateSolver(hyperParameters)
    const external: unknown = candidate
    if (external instanceof HighDensitySolverA01) {
      const method = this.methodCase.startsWith("setup") ? "setup" : "getOutput"
      const original = external[method]
      if (this.methodCase.endsWith("readonly")) {
        Object.defineProperty(external, method, { value: original, writable: false, configurable: true })
      } else {
        Object.defineProperty(external, method, { configurable: true, get: (): typeof original => {
          this.getterReads++
          return original
        } })
      }
    }
    return candidate
  }
}

test("non-writable or accessor grid methods retain eager behavior without deferred wrapper assignment", (): void => {
  const node: NodeWithPortPoints = { capacityMeshNodeId: "method-descriptor-contract",
    center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0, 1],
    portPoints: [
      { connectionName: "A", x: -1, y: 0, z: 0 },
      { connectionName: "A", x: 1, y: 0, z: 1 },
    ] }
  for (const methodCase of ["setup-readonly", "getOutput-readonly", "setup-accessor", "getOutput-accessor"] as const) {
    const params = { nodeWithPortPoints: node, traceWidth: 0.1, viaDiameter: 0.3, cacheProvider: null }
    const eager = new FixedMethodPortfolio({ ...params, portfolioMode: "eager" }, methodCase)
    const lazy = new FixedMethodPortfolio({ ...params, portfolioMode: "lazy" }, methodCase)
    eager.initializeSolvers()
    lazy.initializeSolvers()
    expect(policySnapshot(lazy)).toEqual(policySnapshot(eager))
    const grid = lazy.supervisedSolvers!.find(({ solver }) => solver instanceof HighDensitySolverA01)!.solver as unknown as HighDensitySolverA01
    expect(grid._setupDone).toBe(true)
    expect(lazy.getterReads).toBe(eager.getterReads)
    eager.step()
    lazy.step()
    expect(policySnapshot(lazy)).toEqual(policySnapshot(eager))
    expect(lazy.solved).toBe(true)
    expect(lazy.solvedRoutes).toEqual(eager.solvedRoutes)
  }
})
