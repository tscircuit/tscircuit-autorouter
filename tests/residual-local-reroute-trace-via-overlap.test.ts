import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { ResidualLocalRerouteSolver } from "lib/solvers/ResidualLocalRerouteSolver/ResidualLocalRerouteSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("residual local rerouting moves the via named only by a trace overlap", () => {
  const viaRoute: HighDensityRoute = {
    connectionName: "via-route",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [{ x: 0, y: 0 }],
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
    ],
  }
  const traceRoute: HighDensityRoute = {
    connectionName: "trace",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -1, y: 0.15, z: 0 },
      { x: 1, y: 0.15, z: 0 },
    ],
  }
  const error = {
    type: "pcb_trace_error",
    pcb_trace_id: "trace_0",
    center: { x: 0, y: 0.15 },
    message:
      'PCB trace trace_0 overlaps with pcb_via "pcb_via[#via_0]" (accidental contact)',
  }
  const evaluator: DrcEvaluator = ({ routes }) => {
    if (!routes) throw new Error("Expected routes for DRC evaluation")
    const errors = routes[0]!.vias[0]!.y < 0 ? [] : [error]
    return { errors, errorsWithCenters: errors }
  }
  const solver = new ResidualLocalRerouteSolver({
    hdRoutes: [viaRoute, traceRoute],
    drcEvaluator: evaluator,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    layerCount: 2,
    effort: 50,
    maxCandidateAttempts: 1,
    maxAcceptedMoves: 1,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.stats.residualLocalRerouteFinalDrcIssueCount).toBe(0)
  expect(solver.stats.residualLocalRerouteCandidateAttempts).toBe(1)
  expect(solver.getOutput()[0]!.vias[0]!.y).toBeLessThan(0)
  expect(solver.getOutput()[1]).toEqual(traceRoute)
})
