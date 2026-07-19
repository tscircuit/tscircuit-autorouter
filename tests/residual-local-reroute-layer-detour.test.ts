import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import {
  createResidualLocalRerouteSolver,
  residualLocalRerouteError,
} from "./fixtures/residual-local-reroute"

test("residual local rerouting clears a same-layer error with a layer detour", () => {
  const evaluator: DrcEvaluator = ({ routes }) => {
    if (!routes) throw new Error("Expected routes for DRC evaluation")
    const movedToAnotherLayer = routes[0]!.route.some((point) => point.z === 1)
    const errors = movedToAnotherLayer ? [] : [residualLocalRerouteError]
    return { errors, errorsWithCenters: errors }
  }
  const solver = createResidualLocalRerouteSolver(evaluator, 0.04)

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.stats.residualLocalRerouteAcceptedMoves).toBe(1)
  expect(solver.stats.residualLocalRerouteFinalDrcIssueCount).toBe(0)
  expect(solver.getOutput()[0]!.route.some((point) => point.z === 1)).toBe(true)
})
