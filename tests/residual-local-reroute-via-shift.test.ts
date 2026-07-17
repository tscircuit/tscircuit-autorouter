import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { ResidualLocalRerouteSolver } from "lib/solvers/ResidualLocalRerouteSolver/ResidualLocalRerouteSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("residual local rerouting moves an internal via away from a trace", () => {
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
    connectionName: "trace-route",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -1, y: 0.15, z: 0 },
      { x: 1, y: 0.15, z: 0 },
    ],
  }
  const viaTraceError = {
    type: "pcb_via_trace_clearance_error",
    pcb_via_id: "pcb_via_0",
    pcb_trace_id: "trace-route_0",
    center: { x: 0, y: 0.15 },
    via_center: { x: 0, y: 0 },
    message:
      "Via pcb_via[#pcb_via_0] and trace trace-route are too close (clearance: 0.05mm, minimum: 0.1mm)",
  }
  const evaluator: DrcEvaluator = ({ routes }) => {
    if (!routes) throw new Error("Expected routes for DRC evaluation")
    const errors = routes[0]!.vias[0]!.y < -0.01 ? [] : [viaTraceError]
    return { errors, errorsWithCenters: errors }
  }
  const solver = new ResidualLocalRerouteSolver({
    hdRoutes: [viaRoute, traceRoute],
    drcEvaluator: evaluator,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    layerCount: 2,
    effort: 50,
    maxCandidateAttempts: 6,
    maxAcceptedMoves: 1,
  })

  solver.solve()

  const output = solver.getOutput()
  expect(solver.failed).toBe(false)
  expect(solver.stats.residualLocalRerouteFinalDrcIssueCount).toBe(0)
  expect(solver.stats.residualLocalRerouteAcceptedMoves).toBe(1)
  expect(output[0]!.vias[0]!.y).toBeLessThan(-0.01)
  expect(output[0]!.route[1]!.y).toBe(output[0]!.vias[0]!.y)
  expect(output[0]!.route[2]!.y).toBe(output[0]!.vias[0]!.y)
  expect(output[1]).toEqual(traceRoute)
})
