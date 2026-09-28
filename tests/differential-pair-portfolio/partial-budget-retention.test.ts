import { expect, test } from "bun:test"
import { runPairPortfolio } from "../../scripts/differential-pair-portfolio/runPairPortfolio"
import { createPortfolioInput } from "./createPortfolioInput"

test("portfolio budget retains a validated pair while preserving the pending pair", (): void => {
  const input = createPortfolioInput(["a"])
  input.params.bounds.maxY = 7
  const pendingRoutes = input.params.hdRoutes.map((route) => ({
    ...route,
    connectionName: `${route.connectionName}2`,
    route: route.route.map((point) => ({ ...point, y: point.y + 4 })),
  }))
  input.params.hdRoutes.push(...pendingRoutes)
  // Measure the deterministic generator-step count for the first pair with the
  // same immutable copper and grid before interrupting a two-pair run there.
  const firstOnly = runPairPortfolio(input)
  expect(firstOnly.status).toBe("valid")
  input.params.differentialPairs.push({
    ...input.params.differentialPairs[0]!,
    connectionNames: ["P2", "N2"],
  })
  input.constraints!.push({
    ...input.constraints![0]!,
    connectionNames: ["P2", "N2"],
  })
  input.maxSteps = firstOnly.steps
  const result = runPairPortfolio(input)
  expect(result.status).toBe("best-effort")
  expect(result.winner).toBeNull()
  expect(result.unfinished).toEqual(["a"])
  expect(result.hdRoutes.slice(0, 2)).toEqual(firstOnly.hdRoutes.slice(0, 2))
  expect(result.hdRoutes.slice(0, 2)).not.toEqual(
    input.params.hdRoutes.slice(0, 2),
  )
  expect(result.hdRoutes.slice(2)).toEqual(pendingRoutes)
  expect(result.steps).toBe(input.maxSteps)
})
