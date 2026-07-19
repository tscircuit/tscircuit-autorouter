import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { ResidualLocalRerouteSolver } from "lib/solvers/ResidualLocalRerouteSolver/residual-local-reroute-solver"
import type { HighDensityRoute } from "lib/types/high-density-types"

const routes: HighDensityRoute[] = Array.from(
  { length: 10 },
  (_, index) => -0.45 + index * 0.1,
).map((y) => ({
  connectionName: `route-${y}`,
  traceThickness: 0.1,
  viaDiameter: 0.3,
  vias: [],
  route: [
    { x: -1, y, z: 0 },
    { x: 1, y, z: 0 },
  ],
}))

const errors = routes.map((route) => ({
  type: "pcb_trace_error",
  pcb_trace_id: `${route.connectionName}_0`,
  pcb_trace_error_id: `overlap_${route.connectionName}_0_obstacle`,
  center: { x: 0, y: route.route[0]!.y },
  message: "Trace overlaps an obstacle",
}))

test("residual rerouting stops a long score plateau before its global cap", () => {
  const evaluator: DrcEvaluator = () => ({ errors, errorsWithCenters: errors })
  const solver = new ResidualLocalRerouteSolver({
    hdRoutes: routes,
    drcEvaluator: evaluator,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    layerCount: 2,
    effort: 50,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.stats.residualLocalRerouteCandidateAttempts).toBe(113)
  expect(solver.stats.residualLocalRerouteStoppedAfterCountPlateau).toBe(true)
  expect(solver.stats.residualLocalRerouteHitCandidateLimit).toBe(false)
})

