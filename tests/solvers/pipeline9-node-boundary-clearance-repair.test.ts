import { expect, test } from "bun:test"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { getRouteObstacleClearance } from "high-density-repair02/lib/high-density-repair-solver/functions/repairNodeClearance"

test("Pipeline9 repairs pad clearance inside the node boundary buffer without moving ports", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "node",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [],
  }
  const route: HighDensityRoute = {
    connectionName: "trace",
    regionId: "node",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -1, y: -0.79, z: 0 },
      { x: 1, y: -0.79, z: 0 },
    ],
  }
  const obstacle: Obstacle = {
    type: "rect",
    center: { x: -0.3, y: -0.54 },
    width: 0.8,
    height: 0.4,
    layers: ["top"],
    connectedTo: [],
  }
  const params = {
    nodeWithPortPoints: [node],
    hdRoutes: [route],
    obstacles: [obstacle],
  }
  const baseline = new Pipeline4HighDensityRepairSolver(params)
  baseline.solve()
  expect(baseline.stats.nodeClearanceFinalConflictCount).toBe(1)

  const solver = new Pipeline4HighDensityRepairSolver({
    ...params,
    enableNodeBoundaryClearanceRepair: true,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.nodeClearanceInitialConflictCount).toBe(1)
  expect(solver.stats.nodeClearanceFinalConflictCount).toBe(0)
  expect(solver.stats.nodeBoundaryClearanceResolvedConflictCount).toBe(1)
  expect(solver.stats.nodeBoundaryClearanceCandidateCount).toBeGreaterThan(0)
  expect(solver.stats.nodeBoundaryClearanceCandidateCount).toBeLessThanOrEqual(48)
  const output = solver.getOutput()[0]!
  expect(output.route[0]).toEqual(route.route[0])
  expect(output.route.at(-1)).toEqual(route.route.at(-1))
  expect(output.vias).toEqual([])
  expect(output.route.every((point) => Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1)).toBe(true)
  expect(getRouteObstacleClearance(output, { ...obstacle, zLayers: [0] })).toBeGreaterThanOrEqual(0.1)
})
