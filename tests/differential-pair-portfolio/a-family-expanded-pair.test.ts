import { expect, test } from "bun:test"
import { runPairPortfolio } from "../../scripts/differential-pair-portfolio/runPairPortfolio"
import { createPortfolioInput } from "./createPortfolioInput"

test("A13 terminal grid stubs normalize into a validated coupled pair", (): void => {
  const input = createPortfolioInput(["a"])
  const original = structuredClone(input.params.hdRoutes)
  const result = runPairPortfolio(input)
  expect(result.status).toBe("valid")
  expect(result.winner).toBe("a")
  expect(result.hdRoutes).not.toEqual(original)
  expect(result.candidates[0]?.validation.issues).toEqual([])
  expect(result.candidates[0]?.validation.pairs[0]?.skewMm).toBeLessThanOrEqual(
    0.02,
  )
  expect(
    result.candidates[0]?.validation.pairs[0]?.coupledFraction?.every(
      (fraction) => fraction > 0.95,
    ),
  ).toBe(true)
  expect(input.params.hdRoutes).toEqual(original)
})
