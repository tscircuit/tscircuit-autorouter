import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { policySnapshot } from "./lazyPortfolioTestUtils"
import { priorityParams } from "./priorityDagTestUtils"

test("lazy allocation preserves charged priority-family setup, initial fitness and aggregate work limits", (): void => {
  const params = { ...priorityParams(), priorityDagSearch: true,
    enableNegotiatedSearch: true, cacheProvider: null }
  const legacy = new PortfolioSingleIntraNodeSolver({ ...params, portfolioMode: "legacy" })
  const eager = new PortfolioSingleIntraNodeSolver({ ...params, portfolioMode: "eager" })
  const lazy = new PortfolioSingleIntraNodeSolver({ ...params, portfolioMode: "lazy" })
  legacy.initializeSolvers()
  eager.initializeSolvers()
  lazy.initializeSolvers()
  const eagerPriority = eager.supervisedSolvers!.filter(({ solver }) => solver instanceof PriorityDagIntraNodeSolver)
  const lazyPriority = lazy.supervisedSolvers!.filter(({ solver }) => solver instanceof PriorityDagIntraNodeSolver)
  expect(eagerPriority.length).toBeGreaterThan(0)
  expect(lazyPriority).toHaveLength(eagerPriority.length)
  expect(eagerPriority.every(({ solver }) => solver.iterations > 0)).toBe(true)
  expect(policySnapshot(eager)).toEqual(policySnapshot(legacy))
  expect(policySnapshot(lazy)).toEqual(policySnapshot(eager))
  for (let index = 0; index < eagerPriority.length; index++) {
    const before = eagerPriority[index]!.solver as PriorityDagIntraNodeSolver
    const after = lazyPriority[index]!.solver as PriorityDagIntraNodeSolver
    expect(after.nativeCandidateIterationLimit).toBe(before.nativeCandidateIterationLimit)
  }
  const eagerA01 = eager.supervisedSolvers!.find(({ solver }) => solver instanceof HighDensitySolverA01)!.solver as unknown as HighDensitySolverA01
  const lazyA01 = lazy.supervisedSolvers!.find(({ solver }) => solver instanceof HighDensitySolverA01)!.solver as unknown as HighDensitySolverA01
  expect(eagerA01._setupDone).toBe(true)
  expect(lazyA01._setupDone).toBe(false)
})
