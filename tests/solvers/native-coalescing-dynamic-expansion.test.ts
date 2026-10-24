import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { NativeCoalescedIntraNodeSolver } from "lib/solvers/HighDensitySolver/NativeCoalescedIntraNodeSolver"
import { nativeCoalescingParams } from "./nativeCoalescingTestUtils"

test("inflated native family cap never inflates adaptive expansion's original per-candidate threshold", () => {
  const params = nativeCoalescingParams(), portfolio = new PortfolioSingleIntraNodeSolver(params)
  const candidate = new NativeCoalescedIntraNodeSolver({ ...params, nativeOrderingFamilySize: 20 })
  portfolio.supervisedSolvers = [{ solver: candidate, hyperParameters: {}, h: 0, g: 0, f: 0 }]
  Reflect.get(portfolio, "refreshDynamicIterationLimit").call(portfolio)
  expect(Reflect.get(portfolio, "dynamicExpansionWorkBudget")).toBe(candidate.nativeCandidateIterationLimit)
  expect(portfolio.MAX_ITERATIONS).toBe(Math.ceil((candidate.MAX_ITERATIONS + 1) / portfolio.MIN_SUBSTEPS))
  candidate.iterations = Math.ceil(candidate.nativeCandidateIterationLimit) - 1
  portfolio.computeG(candidate)
  expect(Reflect.get(portfolio, "shouldExpandPortfolio").call(portfolio)).toBe(false)
  candidate.iterations++
  portfolio.computeG(candidate)
  expect(Reflect.get(portfolio, "shouldExpandPortfolio").call(portfolio)).toBe(true)
  candidate.MAX_ITERATIONS--
  portfolio.computeG(candidate)
  expect(Reflect.get(portfolio, "dynamicExpansionWorkBudget")).toBe(candidate.nativeCandidateIterationLimit)
  expect(candidate.nativeCandidateIterationLimit).not.toBe(candidate.MAX_ITERATIONS)
})
