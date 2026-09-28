import { expect, test } from "bun:test"
import { runPairPortfolio } from "../../scripts/differential-pair-portfolio/runPairPortfolio"
import { createPortfolioInput } from "./createPortfolioInput"

test("blocked A/B searches preserve available copper without claiming pair validity", (): void => {
  const input = createPortfolioInput(["a", "b"])
  input.params.obstacles.push({
    type: "rect",
    center: { x: 0, y: 0 },
    width: 0.6,
    height: 6,
    layers: ["top", "bottom"],
    connectedTo: [],
  })
  const original = structuredClone(input.params.hdRoutes)
  const result = runPairPortfolio(input)
  expect(result.status).toBe("best-effort")
  expect(result.winner).toBeNull()
  expect(result.hdRoutes).toEqual(original)
  expect(result.candidates).toHaveLength(2)
  expect(
    result.candidates.every(
      (candidate) => candidate.validation.status !== "valid",
    ),
  ).toBe(true)
  expect(input.params.hdRoutes).toEqual(original)
})
