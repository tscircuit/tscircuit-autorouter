import { expect, test } from "bun:test"
import { runPairPortfolio } from "../../scripts/differential-pair-portfolio/runPairPortfolio"
import { createPortfolioInput } from "./createPortfolioInput"

test("cooperative portfolio preserves terminal order for a reversed negative lane", (): void => {
  const input = createPortfolioInput(["a", "b", "joint"])
  input.params.hdRoutes[1]!.route.reverse()
  const result = runPairPortfolio(input)
  expect(result.status).toBe("valid")
  expect(result.winner).not.toBeNull()
  for (const [index, route] of result.hdRoutes.entries()) {
    expect(route.route[0]).toMatchObject(
      input.params.hdRoutes[index]!.route[0]!,
    )
    expect(route.route.at(-1)).toMatchObject(
      input.params.hdRoutes[index]!.route.at(-1)!,
    )
  }
  expect(
    result.candidates.find((candidate) => candidate.strategy === result.winner)
      ?.validation.issues,
  ).toEqual([])
})
