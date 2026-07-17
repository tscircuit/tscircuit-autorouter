import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { ResidualLocalRerouteSolver } from "lib/solvers/ResidualLocalRerouteSolver/ResidualLocalRerouteSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("residual local rerouting shifts a trace when an offending via is fixed", () => {
  const fixedViaRoute: HighDensityRoute = {
    connectionName: "fixed-via",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [{ x: 0, y: 0 }],
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0, pcb_port_id: "pcb_port_0" },
      { x: 0, y: 0, z: 1, pcb_port_id: "pcb_port_0" },
      { x: 1, y: 0, z: 1 },
    ],
  }
  const movableTrace: HighDensityRoute = {
    connectionName: "movable-trace",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -1, y: 0.15, z: 0 },
      { x: -0.3, y: 0.15, z: 0 },
      { x: 0.3, y: 0.15, z: 0 },
      { x: 1, y: 0.15, z: 0 },
    ],
  }
  const error = {
    type: "pcb_via_trace_clearance_error",
    pcb_via_id: "pcb_via_0",
    pcb_trace_id: "movable-trace_0",
    center: { x: 0, y: 0.15 },
    via_center: { x: 0, y: 0 },
    message:
      "Via pcb_via[#pcb_via_0] and trace movable-trace are too close (clearance: 0.05mm, minimum: 0.1mm)",
  }
  const evaluator: DrcEvaluator = ({ routes }) => {
    if (!routes) throw new Error("Expected routes for DRC evaluation")
    const errors = routes[1]!.route[1]!.y > 0.15 ? [] : [error]
    return { errors, errorsWithCenters: errors }
  }
  const solver = new ResidualLocalRerouteSolver({
    hdRoutes: [fixedViaRoute, movableTrace],
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
  expect(solver.getOutput()[0]).toEqual(fixedViaRoute)
  expect(solver.getOutput()[1]!.route[1]!.y).toBeGreaterThan(0.15)
})
