import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { ResidualLocalRerouteSolver } from "lib/solvers/ResidualLocalRerouteSolver/residual-local-reroute-solver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("residual local rerouting snaps a disconnected terminal to its exact pad center", () => {
  const route: HighDensityRoute = {
    connectionName: "trace",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: 0, y: 0, z: 0, pcb_port_id: "pcb_port_target" },
      { x: 1, y: 0, z: 0 },
    ],
  }
  const error = {
    type: "pcb_trace_error",
    pcb_trace_id: "trace_0",
    center: { x: 0, y: 0 },
    pad_center: { x: -0.4, y: -0.4 },
    message:
      "Trace [trace_0] is missing a connection to smtpad[#pcb_port_target]",
  }
  const evaluator: DrcEvaluator = ({ routes }) => {
    if (!routes) throw new Error("Expected routes for DRC evaluation")
    const terminal = routes[0]!.route[0]!
    const errors = terminal.x === -0.4 && terminal.y === -0.4 ? [] : [error]
    return { errors, errorsWithCenters: errors }
  }
  const solver = new ResidualLocalRerouteSolver({
    hdRoutes: [route],
    drcEvaluator: evaluator,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    layerCount: 2,
    effort: 50,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.stats.residualLocalRerouteFinalDrcIssueCount).toBe(0)
  expect(solver.stats.residualLocalRerouteCandidateAttempts).toBe(1)
  expect(solver.getOutput()[0]!.route[0]).toMatchObject({
    x: -0.4,
    y: -0.4,
    pcb_port_id: "pcb_port_target",
  })
})

