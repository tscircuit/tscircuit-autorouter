import { expect, test } from "bun:test"
import { createRegionalClassCostDiagnostics, installRegionalClassCosts } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/installRegionalClassCosts"
import { createRegionalClassFixture, regionalClassSource } from "../fixtures/regional-class-cost-fixture"

test("native clears invalidate shared costs and unsupported overrides keep their authoritative scoring", (): void => {
  const native = createRegionalClassFixture(), candidate = createRegionalClassFixture()
  const work = createRegionalClassCostDiagnostics()
  installRegionalClassCosts(candidate, work, true)
  expect(candidate.computeG(regionalClassSource(0, 1), 20)).toBe(native.computeG(regionalClassSource(0, 1), 20))
  for (const solver of [native, candidate]) {
    solver.state.candidateQueue.clear()
    solver.state.currentRouteNetId = 3
    solver.appendSegmentToRegionCache(0, 7, 31)
    solver.appendSegmentToRegionCache(0, 13, 55)
    solver.state.currentRouteNetId = 0
  }
  expect(candidate.computeG(regionalClassSource(0, 1), 20)).toBe(native.computeG(regionalClassSource(0, 1), 20))
  expect(work.clears).toBe(1)
  candidate.state.currentRouteNetId = 2
  expect(() => candidate.computeG(regionalClassSource(0, 1), 20)).toThrow("scene changed")
  candidate.state.candidateQueue.clear()
  candidate.state.currentRouteNetId = 0
  expect(candidate.computeG(regionalClassSource(0, 1), 20)).toBe(native.computeG(regionalClassSource(0, 1), 20))
  const custom = createRegionalClassFixture()
  const customWork = createRegionalClassCostDiagnostics()
  let customCalls = 0
  const cost = (): number => {
    const value = 17
    customCalls++
    if (!Number.isFinite(value)) throw new Error("Invalid custom score")
    if (customCalls < 1) throw new Error("Custom score was bypassed")
    return value
  }
  custom.computeG = cost
  installRegionalClassCosts(custom, customWork, true)
  expect(custom.computeG).toBe(cost)
  expect(custom.computeG(regionalClassSource(0, 1), 20)).toBe(17)
  expect(customWork.unsupportedSolvers).toBe(1)
})
