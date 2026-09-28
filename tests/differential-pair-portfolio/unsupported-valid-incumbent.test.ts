import { expect, test } from "bun:test"
import { runPairPortfolio } from "../../scripts/differential-pair-portfolio/runPairPortfolio"
import { createPortfolioInput } from "./createPortfolioInput"

test("unsupported A13 search preserves a valid incumbent without claiming a strategy win", (): void => {
  const input = createPortfolioInput(["a"])
  input.params.bounds = { minX: -100, maxX: 100, minY: -100, maxY: 100 }
  for (const route of input.params.hdRoutes) {
    route.route = [route.route[0]!, route.route.at(-1)!]
  }
  const original = structuredClone(input.params.hdRoutes)
  const result = runPairPortfolio(input)
  expect(result.status).toBe("valid")
  expect(result.winner).toBeNull()
  expect(result.hdRoutes).toEqual(original)
  expect(result.candidates).toHaveLength(1)
  expect(result.candidates[0]?.acceptedPairCount).toBe(0)
  expect(result.candidates[0]?.generatedCandidateCount).toBe(0)
  expect(
    result.candidates[0]?.notes.some((note) =>
      note.includes("limit is 2000000"),
    ),
  ).toBe(true)
  expect(input.params.hdRoutes).toEqual(original)
})
