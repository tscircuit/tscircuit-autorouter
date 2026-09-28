import { expect, test } from "bun:test"
import { runPairPortfolio } from "../../scripts/differential-pair-portfolio/runPairPortfolio"
import { createPortfolioInput } from "./createPortfolioInput"

test("actual B01 spine expands and tunes into a validated coupled pair", (): void => {
  const input = createPortfolioInput(["b"])
  const result = runPairPortfolio(input)
  expect(result.status).toBe("valid")
  expect(result.winner).toBe("b")
  expect(result.hdRoutes).not.toEqual(input.params.hdRoutes)
  expect(result.candidates[0]?.validation.issues).toEqual([])
  expect(result.candidates[0]?.validation.pairs[0]?.skewMm).toBeLessThanOrEqual(
    0.02,
  )
  expect(
    result.candidates[0]?.validation.pairs[0]?.coupledFraction?.every(
      (fraction) => fraction > 0.95,
    ),
  ).toBe(true)
})
