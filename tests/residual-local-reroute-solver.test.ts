import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { ResidualLocalRerouteSolver } from "lib/solvers/ResidualLocalRerouteSolver/ResidualLocalRerouteSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

const inputRoute: HighDensityRoute = {
  connectionName: "route",
  traceThickness: 0.1,
  viaDiameter: 0.3,
  vias: [],
  route: [
    { x: -1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
  ],
}

const residualError = {
  type: "pcb_trace_error",
  pcb_trace_id: "route_0",
  pcb_trace_error_id: "overlap_route_0_pcb_smtpad_obstacle",
  center: { x: 0, y: 0 },
  message: "Trace overlaps an obstacle",
}

const createSolver = (
  drcEvaluator: DrcEvaluator,
  maxCandidateAttempts: number,
): ResidualLocalRerouteSolver =>
  new ResidualLocalRerouteSolver({
    hdRoutes: [inputRoute],
    drcEvaluator,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    effort: 50,
    maxCandidateAttempts,
    maxAcceptedMoves: 2,
  })

test("residual local rerouting accepts only improvements and terminates at convergence or its hard cap", () => {
  const improvingEvaluator: DrcEvaluator = ({ routes }) => {
    if (!routes) throw new Error("Expected routes for DRC evaluation")
    const errors = routes[0]!.route.length > 2 ? [] : [residualError]
    return { errors, errorsWithCenters: errors }
  }
  const improvingSolver = createSolver(improvingEvaluator, 10)
  improvingSolver.solve()

  expect(improvingSolver.failed).toBe(false)
  expect(improvingSolver.getOutput()[0]!.route).toHaveLength(4)
  expect(improvingSolver.stats.residualLocalRerouteInitialDrcIssueCount).toBe(1)
  expect(improvingSolver.stats.residualLocalRerouteFinalDrcIssueCount).toBe(0)
  expect(improvingSolver.stats.residualLocalRerouteCandidateAttempts).toBe(1)
  expect(improvingSolver.stats.residualLocalRerouteAcceptedMoves).toBe(1)

  const unchangedEvaluator: DrcEvaluator = () => ({
    errors: [residualError],
    errorsWithCenters: [residualError],
  })
  const cappedSolver = createSolver(unchangedEvaluator, 3)
  cappedSolver.solve()

  expect(cappedSolver.failed).toBe(false)
  expect(cappedSolver.getOutput()[0]!.route).toEqual(inputRoute.route)
  expect(cappedSolver.stats.residualLocalRerouteCandidateAttempts).toBe(3)
  expect(cappedSolver.stats.residualLocalRerouteAcceptedMoves).toBe(0)
  expect(cappedSolver.stats.residualLocalRerouteHitCandidateLimit).toBe(true)

  const convergedSolver = createSolver(unchangedEvaluator, 100)
  convergedSolver.solve()

  expect(convergedSolver.failed).toBe(false)
  expect(convergedSolver.getOutput()[0]!.route).toEqual(inputRoute.route)
  expect(convergedSolver.stats.residualLocalRerouteCandidateAttempts).toBe(24)
  expect(
    convergedSolver.stats.residualLocalRerouteStoppedAfterNoImprovement,
  ).toBe(true)
  expect(convergedSolver.stats.residualLocalRerouteHitCandidateLimit).toBe(
    false,
  )

  const disabledEvaluator: DrcEvaluator = () => {
    throw new Error("Disabled rerouting must not evaluate DRC")
  }
  const disabledSolver = createSolver(disabledEvaluator, 0)
  disabledSolver.solve()

  expect(disabledSolver.failed).toBe(false)
  expect(disabledSolver.getOutput()[0]!.route).toEqual(inputRoute.route)
  expect(disabledSolver.stats.residualLocalRerouteDisabled).toBe(true)
})
