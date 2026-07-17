import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { ResidualLocalRerouteSolver } from "lib/solvers/ResidualLocalRerouteSolver/ResidualLocalRerouteSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("residual local rerouting moves a split same-net via junction as one unit", () => {
  const firstFragment: HighDensityRoute = {
    connectionName: "net-fragment-a",
    rootConnectionName: "net",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [{ x: 0, y: 0 }],
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ],
  }
  const secondFragment: HighDensityRoute = {
    connectionName: "net-fragment-b",
    rootConnectionName: "net",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
    ],
  }
  const obstacleTrace: HighDensityRoute = {
    connectionName: "obstacle",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -1, y: 0.15, z: 0 },
      { x: 1, y: 0.15, z: 0 },
    ],
  }
  const error = {
    type: "pcb_via_trace_clearance_error",
    pcb_via_id: "pcb_via_0",
    pcb_trace_id: "obstacle_0",
    center: { x: 0, y: 0.15 },
    via_center: { x: 0, y: 0 },
    message:
      "Via pcb_via[#pcb_via_0] and trace obstacle are too close (clearance: 0.05mm, minimum: 0.1mm)",
  }
  const evaluator: DrcEvaluator = ({ routes }) => {
    if (!routes) throw new Error("Expected routes for DRC evaluation")
    const errors = routes[0]!.vias[0]!.y < -0.01 ? [] : [error]
    return { errors, errorsWithCenters: errors }
  }
  const solver = new ResidualLocalRerouteSolver({
    hdRoutes: [firstFragment, secondFragment, obstacleTrace],
    drcEvaluator: evaluator,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    layerCount: 2,
    effort: 50,
    maxCandidateAttempts: 6,
    maxAcceptedMoves: 1,
  })

  solver.solve()

  const output = solver.getOutput()
  const movedY = output[0]!.vias[0]!.y
  expect(solver.failed).toBe(false)
  expect(solver.stats.residualLocalRerouteFinalDrcIssueCount).toBe(0)
  expect(output[0]!.route.at(-1)!.y).toBe(movedY)
  expect(output[1]!.route[0]!.y).toBe(movedY)
  expect(output[2]).toEqual(obstacleTrace)
})
