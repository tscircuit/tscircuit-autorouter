import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import {
  createResidualLocalRerouteSolver,
  residualLocalRerouteError,
  residualLocalRerouteInputRoute,
} from "./fixtures/residual-local-reroute"

test("residual local rerouting accepts improvements and stops at convergence", () => {
  const improvingEvaluator: DrcEvaluator = ({ routes }) => {
    if (!routes) throw new Error("Expected routes for DRC evaluation")
    const errors =
      routes[0]!.route.length > 2 ? [] : [residualLocalRerouteError]
    return { errors, errorsWithCenters: errors }
  }
  const improvingSolver = createResidualLocalRerouteSolver(
    improvingEvaluator,
    1,
  )
  improvingSolver.solve()

  expect(improvingSolver.failed).toBe(false)
  expect(improvingSolver.getOutput()[0]!.route.length).toBeGreaterThan(2)
  expect(improvingSolver.stats.residualLocalRerouteInitialDrcIssueCount).toBe(1)
  expect(improvingSolver.stats.residualLocalRerouteFinalDrcIssueCount).toBe(0)
  expect(improvingSolver.stats.residualLocalRerouteCandidateAttempts).toBe(1)
  expect(improvingSolver.stats.residualLocalRerouteAcceptedMoves).toBe(1)

  const unchangedEvaluator: DrcEvaluator = () => ({
    errors: [residualLocalRerouteError],
    errorsWithCenters: [residualLocalRerouteError],
  })
  const convergedSolver = createResidualLocalRerouteSolver(
    unchangedEvaluator,
    1,
  )
  convergedSolver.solve()

  expect(convergedSolver.failed).toBe(false)
  expect(convergedSolver.getOutput()[0]!.route).toEqual(
    residualLocalRerouteInputRoute.route,
  )
  expect(
    convergedSolver.stats.residualLocalRerouteStoppedAfterNoImprovement,
  ).toBe(true)
  expect(convergedSolver.stats.residualLocalRerouteHitCandidateLimit).toBe(
    false,
  )
})
