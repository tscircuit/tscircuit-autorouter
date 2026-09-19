import { expect, test } from "bun:test"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types"

test("node repair includes pads within the board's via-clearance search margin", (): void => {
  const route: HighDensityRoute = {
    connectionName: "signal", regionId: "node", traceThickness: 0.1, viaDiameter: 0.45,
    route: [
      { x: 0.9, y: -1, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
      { x: 0.9, y: 1, z: 1 },
    ],
    vias: [{ x: 1, y: 0 }],
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "node", center: { x: 0, y: 0 }, width: 2, height: 2,
    availableZ: [0, 1], portPoints: [],
  }
  const pad: Obstacle = {
    type: "rect", center: { x: 1.5, y: 0 }, width: 0.2, height: 0.2,
    layers: ["top"], connectedTo: ["clock"],
  }
  const solver = new Pipeline4HighDensityRepairSolver({
    nodeWithPortPoints: [node], hdRoutes: [route], obstacles: [pad],
    minViaEdgeToPadEdgeClearance: 0.25, minTraceToPadEdgeClearance: 0.16,
  })
  expect(solver.sampleEntries[0]!.sample.clearanceObstacles).toHaveLength(1)
  expect(solver.sampleEntries[0]!.sample.minViaEdgeToPadEdgeClearance).toBe(0.25)
  solver.solve()
  expect(solver.failed).toBe(false)
  const via = solver.getOutput()[0]!.vias[0]!
  const gap = Math.hypot(
    Math.max(Math.abs(via.x - pad.center.x) - pad.width / 2, 0),
    Math.max(Math.abs(via.y - pad.center.y) - pad.height / 2, 0),
  ) - route.viaDiameter / 2
  expect(gap).toBeGreaterThanOrEqual(0.25 - 1e-6)
})
