import { expect, test } from "bun:test"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

type RepairParams = ConstructorParameters<
  typeof Pipeline4HighDensityRepairSolver
>[0]

test("Pipeline9 leaves multi-conflict nodes unchanged for global repair", () => {
  const routes: HighDensityRoute[] = [0, 1].map((z) => ({
    connectionName: `trace${z}`,
    regionId: "node",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -1, y: -0.79, z },
      { x: 1, y: -0.79, z },
    ],
  }))
  const params: RepairParams = {
    nodeWithPortPoints: [
      {
        capacityMeshNodeId: "node",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        availableZ: [0, 1],
        portPoints: [],
      },
    ],
    hdRoutes: routes,
    obstacles: [
      {
        type: "rect",
        center: { x: -0.3, y: -0.54 },
        width: 0.8,
        height: 0.4,
        layers: ["top", "bottom"],
        connectedTo: [],
      },
    ],
  }
  const baseline = new Pipeline4HighDensityRepairSolver(params)
  baseline.solve()
  expect(baseline.stats.nodeClearanceFinalConflictCount).toBe(2)

  const solver = new Pipeline4HighDensityRepairSolver({
    ...params,
    enableNodeBoundaryClearanceRepair: true,
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.stats.nodeBoundaryClearanceCandidateCount).toBe(0)
  expect(solver.stats.nodeClearanceFinalConflictCount).toBe(2)
  expect(solver.getOutput()).toEqual(baseline.getOutput())
})
