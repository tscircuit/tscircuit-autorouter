import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { ResidualLocalRerouteSolver } from "lib/solvers/ResidualLocalRerouteSolver/residual-local-reroute-solver"
import {
  residualLocalRerouteError,
  residualLocalRerouteInputRoute,
} from "./fixtures/residual-local-reroute"

test("residual local rerouting does not revisit unchanged failed candidates", () => {
  const secondRoute = {
    ...residualLocalRerouteInputRoute,
    connectionName: "second-route",
    route: residualLocalRerouteInputRoute.route.map((point) => ({
      ...point,
      y: 1,
    })),
  }
  const secondError = {
    ...residualLocalRerouteError,
    pcb_trace_id: "second-route_0",
    center: { x: 0, y: 1 },
  }
  const evaluator: DrcEvaluator = ({ routes }) => {
    if (!routes) throw new Error("Expected routes for DRC evaluation")
    const errors = [residualLocalRerouteError]
    if (routes[1]!.route.every((point) => point.z === 0)) {
      errors.push(secondError)
    }
    return { errors, errorsWithCenters: errors }
  }
  const solver = new ResidualLocalRerouteSolver({
    hdRoutes: [residualLocalRerouteInputRoute, secondRoute],
    drcEvaluator: evaluator,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    layerCount: 2,
    effort: 1,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.stats.residualLocalRerouteAcceptedMoves).toBe(1)
  expect(solver.stats.residualLocalRerouteStoppedAfterNoImprovement).toBe(true)
  expect(solver.stats.residualLocalRerouteHitCandidateLimit).toBe(false)
  expect(solver.stats.residualLocalRerouteSweepsStarted).toBe(2)
  expect(solver.stats.residualLocalRerouteUniqueCandidatesVisited).toBeGreaterThan(
    solver.stats.residualLocalRerouteCandidateAttempts,
  )
})
