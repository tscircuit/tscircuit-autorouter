import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { ResidualLocalRerouteSolver } from "lib/solvers/ResidualLocalRerouteSolver/ResidualLocalRerouteSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("residual local rerouting detours a multi-segment trace around a pad", () => {
  const route: HighDensityRoute = {
    connectionName: "trace",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -1, y: 0.4, z: 0 },
      { x: -0.2, y: 0.05, z: 0 },
      { x: 0.2, y: 0.05, z: 0 },
      { x: 1, y: 0.4, z: 0 },
    ],
  }
  const error = {
    type: "pcb_trace_error",
    pcb_trace_id: "trace_0",
    center: { x: 0, y: 0.1 },
    message:
      'PCB trace trace_0 overlaps with pcb_smtpad "pcb_port[#pcb_port_obstacle]" (accidental contact)',
  }
  const evaluator: DrcEvaluator = ({ routes }) => {
    if (!routes) throw new Error("Expected routes for DRC evaluation")
    const errors = routes[0]!.route[1]!.y >= 0.25 ? [] : [error]
    return { errors, errorsWithCenters: errors }
  }
  const solver = new ResidualLocalRerouteSolver({
    hdRoutes: [route],
    drcEvaluator: evaluator,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [
      {
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.2,
        connectedTo: ["pcb_port_obstacle"],
      },
    ],
    layerCount: 2,
    effort: 50,
    maxCandidateAttempts: 1,
    maxAcceptedMoves: 1,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.stats.residualLocalRerouteFinalDrcIssueCount).toBe(0)
  expect(solver.stats.residualLocalRerouteCandidateAttempts).toBe(1)
  expect(solver.getOutput()[0]!.route[1]!.y).toBeCloseTo(0.25)
})
