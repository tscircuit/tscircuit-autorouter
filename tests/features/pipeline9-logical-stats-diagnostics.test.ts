import { expect, test } from "bun:test"
import { getPipeline9LogicalStats } from "../fixtures/getPipeline9LogicalStats"

test("logical parity excludes only three validated elapsed observations and retains all work", (): void => {
  const input = { learnedComputeElapsedMs: 2, learnedComputeValidationElapsedMs: 0, learnedComputePortfolioOverheadMs: 3,
    learnedComputePredictionElapsedMs: 0.5, learnedComputePortfolioWork: 0.73, learnedComputeObservedWinnerOracleWork: 0.03,
    learnedComputeDecisionCount: 0, iterations: 123, otherElapsedMs: 7, futureStatistic: 9 }
  const expected = { learnedComputePredictionElapsedMs: 0.5, learnedComputePortfolioWork: 0.73, learnedComputeObservedWinnerOracleWork: 0.03,
    learnedComputeDecisionCount: 0, iterations: 123, otherElapsedMs: 7, futureStatistic: 9 }
  expect(getPipeline9LogicalStats(input)).toEqual(expected)
  expect(input.learnedComputeElapsedMs).toBe(2)
  expect(getPipeline9LogicalStats({ ...input, learnedComputeElapsedMs: 200 })).toEqual(expected)
  for (const key of ["learnedComputeElapsedMs", "learnedComputeValidationElapsedMs", "learnedComputePortfolioOverheadMs"]) {
    for (const value of [Number.NaN, Infinity, -Infinity, -1, "1", undefined]) {
      expect(() => getPipeline9LogicalStats({ ...input, [key]: value })).toThrow(key)
    }
  }
  expect(getPipeline9LogicalStats({ learnedComputePortfolioWork: 0.73 })).toEqual({ learnedComputePortfolioWork: 0.73 })
  expect(getPipeline9LogicalStats({ ...input, learnedComputePortfolioWork: 0.71 })).not.toEqual(expected)
  expect(getPipeline9LogicalStats({ ...input, learnedComputeObservedWinnerOracleWork: 0.01 })).not.toEqual(expected)
})
