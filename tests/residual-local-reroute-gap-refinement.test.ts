import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import {
  createResidualLocalRerouteSolver,
  residualLocalRerouteError,
} from "./fixtures/residual-local-reroute"

test("residual local rerouting accepts a smaller reported clearance gap", () => {
  const createGapError = (gap: number): typeof residualLocalRerouteError => ({
    ...residualLocalRerouteError,
    message: `Trace is too close to another trace (gap: ${gap.toFixed(3)}mm)`,
  })
  const evaluator: DrcEvaluator = ({ routes }) => {
    if (!routes) throw new Error("Expected routes for DRC evaluation")
    const gap = routes[0]!.route.length > 2 ? 0.08 : 0.04
    const errors = [createGapError(gap)]
    return { errors, errorsWithCenters: errors }
  }
  const solver = createResidualLocalRerouteSolver(evaluator, 0.01)

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.getOutput()[0]!.route.length).toBeGreaterThan(2)
  expect(solver.stats.residualLocalRerouteAcceptedMoves).toBe(1)
  expect(solver.stats.residualLocalRerouteFinalDrcIssueScore).toBeCloseTo(0.02)
})
