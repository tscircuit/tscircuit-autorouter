import { expect, test } from "bun:test"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { createStraightRoutePreflightContext, getCertifiedStraightIntraNodeRoutes } from "lib/solvers/HyperHighDensitySolver/getCertifiedStraightIntraNodeRoutes"

const certify = (obstacle: Obstacle): HighDensityIntraNodeRoute[] | null => {
  return getCertifiedStraightIntraNodeRoutes({
    nodeWithPortPoints: {
      capacityMeshNodeId: "node", center: { x: 0, y: 0 }, width: 8, height: 8,
      portPoints: [{ x: -0.8, y: 2, z: 0, connectionName: "a" }, { x: 2, y: -0.8, z: 0, connectionName: "a" }],
    },
    obstacles: [obstacle],
    boardGeometry: { bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 } },
    straightRoutePreflightContext: createStraightRoutePreflightContext({ minX: -4, maxX: 4, minY: -4, maxY: 4 }),
  })
}

test("circle metadata keeps rectangular SMT copper while actual circular NPTH uses circle distance", () => {
  const obstacle: Obstacle = { type: "rect", shape: "circle", width: 1, height: 1, center: { x: 0, y: 0 }, layers: ["top"], connectedTo: [] }
  expect(certify(obstacle)).toBeNull()
  expect(certify({ ...obstacle, shape: undefined })).toBeNull()
  expect(certify({ ...obstacle, isNonPlatedHole: true })).not.toBeNull()
})
