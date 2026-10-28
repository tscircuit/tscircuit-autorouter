import { expect, test } from "bun:test"
import { HighDensitySolverA01, HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import type { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { policySnapshot } from "./lazyPortfolioTestUtils"

class RestrictedGridPortfolio extends PortfolioSingleIntraNodeSolver {
  override generateSolver(hyperParameters: Record<string, any>): IntraNodeRouteSolver {
    const candidate = super.generateSolver(hyperParameters)
    const external: unknown = candidate
    if (external instanceof HighDensitySolverA01) external.maxCellCount = 1
    if (external instanceof HighDensitySolverA03) external.lowResolutionCellSize = 0.35
    return candidate
  }
}

test("unsupported grid restrictions retain eager setup failure states before an immediate winner", (): void => {
  const node: NodeWithPortPoints = { capacityMeshNodeId: "eager-failure-contract",
    center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0, 1],
    portPoints: [
      { connectionName: "A", x: -1, y: 0, z: 0 },
      { connectionName: "A", x: 1, y: 0, z: 1 },
    ] }
  const params = { nodeWithPortPoints: node, traceWidth: 0.1, viaDiameter: 0.3, cacheProvider: null }
  const eager = new RestrictedGridPortfolio({ ...params, portfolioMode: "eager" })
  const lazy = new RestrictedGridPortfolio({ ...params, portfolioMode: "lazy" })
  eager.initializeSolvers()
  lazy.initializeSolvers()
  expect(policySnapshot(lazy)).toEqual(policySnapshot(eager))
  const grids = lazy.supervisedSolvers!.filter(({ solver }) =>
    solver instanceof HighDensitySolverA01 || solver instanceof HighDensitySolverA03)
  expect(grids).toHaveLength(2)
  expect(grids.every(({ solver }) => solver.failed && (solver as unknown as HighDensitySolverA01)._setupDone)).toBe(true)
  expect(lazy.stats.lazyGridSetupDeferredCount).toBe(0)
  eager.step()
  lazy.step()
  expect(policySnapshot(lazy)).toEqual(policySnapshot(eager))
  expect(lazy.solved).toBe(true)
  expect(lazy.winningSolver!.getSolverName()).toBe("SingleTransitionIntraNodeSolver")
})
