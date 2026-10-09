import { expect, test } from "bun:test"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

test("high density repair preserves through-obstacle metadata", () => {
  const route: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      {
        x: -0.5,
        y: 0,
        z: 0,
        toNextSegmentType: "through_obstacle",
        toNextSegmentCircuitJsonMetadata: {
          pcb_plated_hole_id: "pcb_plated_hole_1",
        },
      },
      { x: -0.5, y: 0, z: 1 },
    ],
    vias: [],
  }
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "cmn_1",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    portPoints: [
      { connectionName: "signal", x: -0.5, y: 0, z: 0 },
      { connectionName: "signal", x: -0.5, y: 0, z: 1 },
    ],
  }
  const solver = new Pipeline4HighDensityRepairSolver({
    nodeWithPortPoints: [nodeWithPortPoints],
    hdRoutes: [route],
    obstacles: [],
    repairMargin: 0.2,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getOutput()[0]!.route[0]).toEqual(route.route[0])
})
