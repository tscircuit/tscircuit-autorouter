import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { ResidualLocalRerouteSolver } from "lib/solvers/ResidualLocalRerouteSolver/residual-local-reroute-solver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("residual local rerouting splits a local detour across two locked traces", () => {
  const createRoute = (
    connectionName: string,
    y: number,
  ): HighDensityRoute => ({
    connectionName,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -1, y, z: 0 },
      { x: 1, y, z: 0 },
    ],
  })
  const error = {
    type: "pcb_trace_error",
    pcb_trace_id: "lower_0",
    pcb_trace_ids: ["lower_0", "upper_0"],
    center: { x: 0, y: 0.075 },
    message: "Traces are too close (gap: 0.050mm)",
  }
  const evaluator: DrcEvaluator = ({ routes }) => {
    if (!routes) throw new Error("Expected routes for DRC evaluation")
    const bothDetoured = routes.every((route) => route.route.length > 2)
    const errors = bothDetoured ? [] : [error]
    return { errors, errorsWithCenters: errors }
  }
  const solver = new ResidualLocalRerouteSolver({
    hdRoutes: [createRoute("lower", 0), createRoute("upper", 0.15)],
    drcEvaluator: evaluator,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    layerCount: 2,
    effort: 50,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.stats.residualLocalRerouteFinalDrcIssueCount).toBe(0)
  expect(solver.stats.residualLocalRerouteCandidateAttempts).toBe(1)
  expect(solver.getOutput().every((route) => route.route.length > 2)).toBe(true)
})

