import { expect, test } from "bun:test"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 boundary-buffer repair skips already clean nodes unchanged", () => {
  const route: HighDensityRoute = {
    connectionName: "trace",
    regionId: "node",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
  }
  const params = {
    nodeWithPortPoints: [{
      capacityMeshNodeId: "node",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0, 1],
      portPoints: [],
    }],
    hdRoutes: [route],
    obstacles: [],
  }
  const baseline = new Pipeline4HighDensityRepairSolver(params)
  const solver = new Pipeline4HighDensityRepairSolver({
    ...params,
    enableNodeBoundaryClearanceRepair: true,
  })
  baseline.solve()
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.nodeClearanceFinalConflictCount).toBe(0)
  expect(solver.stats.nodeBoundaryClearanceCandidateCount).toBe(0)
  expect(solver.getOutput()).toEqual(baseline.getOutput())
})
