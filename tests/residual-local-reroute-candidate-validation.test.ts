import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { ResidualLocalRerouteSolver } from "lib/solvers/ResidualLocalRerouteSolver/residual-local-reroute-solver"
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
  pcb_trace_error_id: "overlap_route_0_obstacle",
  center: { x: 0, y: 0 },
  message: "Trace overlaps an obstacle",
}

test("residual rerouting fully validates only geometry candidates that can improve", () => {
  let rejectedValidationCalls = 0
  const unchangedEvaluator: DrcEvaluator = () => ({
    errors: [residualError],
    errorsWithCenters: [residualError],
  })
  const rejectedSolver = new ResidualLocalRerouteSolver({
    hdRoutes: [inputRoute],
    drcEvaluator: (input) => {
      rejectedValidationCalls += 1
      return unchangedEvaluator(input)
    },
    candidateDrcEvaluator: unchangedEvaluator,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    layerCount: 2,
    effort: 1 / 24,
  })

  rejectedSolver.solve()

  expect(rejectedValidationCalls).toBe(1)
  expect(rejectedSolver.stats.residualLocalRerouteMaxCandidateAttempts).toBe(4)
  expect(rejectedSolver.stats.residualLocalRerouteCandidateDrcEvaluations).toBe(
    5,
  )
  expect(
    rejectedSolver.stats.residualLocalRerouteValidationDrcEvaluations,
  ).toBe(1)

  let acceptedValidationCalls = 0
  const improvingEvaluator: DrcEvaluator = ({ routes }) => {
    if (!routes) throw new Error("Expected routes for DRC evaluation")
    const errors = routes[0]!.route.length > 2 ? [] : [residualError]
    return { errors, errorsWithCenters: errors }
  }
  const acceptedSolver = new ResidualLocalRerouteSolver({
    hdRoutes: [inputRoute],
    drcEvaluator: (input) => {
      acceptedValidationCalls += 1
      return improvingEvaluator(input)
    },
    candidateDrcEvaluator: improvingEvaluator,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    layerCount: 2,
    effort: 50,
  })

  acceptedSolver.solve()

  expect(acceptedValidationCalls).toBe(2)
  expect(acceptedSolver.stats.residualLocalRerouteFinalDrcIssueCount).toBe(0)
})
