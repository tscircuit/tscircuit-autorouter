import { expect, test } from "bun:test"
import { BoundedHighDensityForceImproveSolver } from "lib/solvers/HighDensitySolver/BoundedHighDensityForceImproveSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("copper-only force improvement leaves board-obstacle-constrained regions fixed", (): void => {
  const route: HighDensityRoute = {
    connectionName: "pad-adjacent-trace",
    regionId: "pad-adjacent-node",
    traceThickness: 0.1524,
    viaDiameter: 0.2032,
    route: [
      { x: -1, y: 0, z: 0 },
      { x: -0.3, y: 0.5, z: 0 },
      { x: 0.3, y: 0.5, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    vias: [],
  }
  const original = structuredClone(route)
  const solver = new BoundedHighDensityForceImproveSolver({
    nodeWithPortPoints: [
      {
        capacityMeshNodeId: "pad-adjacent-node",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        availableZ: [0],
        portPoints: [],
      },
    ],
    hdRoutes: [route],
    fixedObstacleRegionIds: new Set(["pad-adjacent-node"]),
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.getOutput()).toEqual([original])
  expect(solver.stats.protectedBoardObstacleRouteCount).toBe(1)
})
