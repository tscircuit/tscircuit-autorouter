import { expect, test } from "bun:test"
import { HighDensitySolverA01, HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { policySnapshot } from "./lazyPortfolioTestUtils"

test("constructor success and ineligibility preserve the immediate eager winner before any grid search", (): void => {
  const node: NodeWithPortPoints = { capacityMeshNodeId: "constructor-transition",
    center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0, 1],
    portPoints: [
      { connectionName: "A", x: -1, y: 0, z: 0 },
      { connectionName: "A", x: 1, y: 0, z: 1 },
    ] }
  const params = { nodeWithPortPoints: node, traceWidth: 0.1, viaDiameter: 0.3,
    enableNegotiatedSearch: true, cacheProvider: null }
  const eager = new PortfolioSingleIntraNodeSolver({ ...params, portfolioMode: "eager" })
  const lazy = new PortfolioSingleIntraNodeSolver({ ...params, portfolioMode: "lazy" })
  eager.initializeSolvers()
  lazy.initializeSolvers()
  expect(policySnapshot(lazy)).toEqual(policySnapshot(eager))
  eager.step()
  lazy.step()
  expect(policySnapshot(lazy)).toEqual(policySnapshot(eager))
  expect(lazy.solved).toBe(true)
  expect(lazy.winningSolver!.getSolverName()).toBe("SingleTransitionIntraNodeSolver")
  expect(lazy.winningSolver!.iterations).toBe(0)
  expect(lazy.iterations).toBe(1)
  expect(JSON.stringify(lazy.solvedRoutes)).toBe(JSON.stringify(eager.solvedRoutes))
  for (const { solver } of lazy.supervisedSolvers!) {
    if (solver instanceof HighDensitySolverA01 || solver instanceof HighDensitySolverA03) {
      expect(solver._setupDone).toBe(false)
      expect(solver.iterations).toBe(0)
    }
  }
})
