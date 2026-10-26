import { expect, test } from "bun:test"
import { raceNode, ScriptedPortfolio } from "../fixtures/hdFamilyRace"

test("preferred-family setup observes another family's complete proposal without charging native search work", (): void => {
  const portfolio = new ScriptedPortfolio(
    { nodeWithPortPoints: raceNode },
    1,
    { plans: { 1: { completeAfter: Infinity, budget: 5 } } },
  )
  const candidates = portfolio.supervisedSolvers!
  portfolio.supervisedSolvers = undefined
  portfolio.initializeSolvers = (): void => {
    portfolio.supervisedSolvers = candidates
    portfolio.other.solvedRoutes = portfolio.native.getOutput()
    portfolio.other.solved = true
  }
  expect(portfolio.getPreferredFamilyState().status).toBe("uninitialized")
  expect(portfolio.stepPreferredFamily()).toBe(0)
  expect(portfolio.solved).toBe(true)
  expect(portfolio.winningSolver).toBe(portfolio.other)
  expect(portfolio.onSolveCalls).toBe(1)
  expect(portfolio.solvedRoutes).toHaveLength(8)
  expect(portfolio.getPreferredFamilyState().won).toBe(false)
  expect(portfolio.native.iterations).toBe(0)
  expect(() => portfolio.stepPreferredFamily()).toThrow("inactive")
})
