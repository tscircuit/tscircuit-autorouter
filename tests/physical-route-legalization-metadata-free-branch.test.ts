import { expect, test } from "bun:test"
import { legalizeHighDensityRouteProposal } from "lib/solvers/HighDensitySolver/legalizeHighDensityRouteProposal"
import { areNodePortPointPairsConnectedByRoutes } from "lib/solvers/HyperHighDensitySolver/repairDisconnectedSameRootPortPoints"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

test("physical projection preserves a metadata-free shared branch junction", () => {
  const trunk = [
    { x: -1, y: -0.3, z: 0 }, { x: -0.5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
    { x: 0.5, y: 0, z: 0 }, { x: 1, y: -0.3, z: 0 },
  ]
  const branch = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }]
  const routes: HighDensityIntraNodeRoute[] = [
    { connectionName: "shared", rootConnectionName: "shared", traceThickness: 0.1,
      viaDiameter: 0.3, route: trunk, vias: [] },
    { connectionName: "shared", rootConnectionName: "shared", traceThickness: 0.1,
      viaDiameter: 0.3, route: branch, vias: [] },
    { connectionName: "other", traceThickness: 0.1, viaDiameter: 0.3,
      route: [{ x: -1, y: 0.2, z: 0 }, { x: 1, y: 0.2, z: 0 }], vias: [] },
  ]
  const node: NodeWithPortPoints = { capacityMeshNodeId: "branch", center: { x: 0, y: 0 }, width: 4, height: 4,
    portPoints: [
      { x: -1, y: -0.3, z: 0, connectionName: "shared" },
      { x: 1, y: -0.3, z: 0, connectionName: "shared" },
      { x: 0, y: 1, z: 0, connectionName: "shared" },
      { x: -1, y: 0.2, z: 0, connectionName: "other" },
      { x: 1, y: 0.2, z: 0, connectionName: "other" },
    ] }
  const original = structuredClone(routes)
  expect(areNodePortPointPairsConnectedByRoutes(routes, node)).toBe(true)
  const result = legalizeHighDensityRouteProposal({ routes, node, mode: "full", layerCount: 2, clearance: 0.4 })
  expect(result.iterations).toBeGreaterThan(0)
  expect(result.status).toBe("improved-needs-repair")
  const junction = result.routes[1]!.route[0]!
  const trunkDistance = Math.min(...result.routes[0]!.route.slice(1).map((point, index) =>
    minimumDistanceBetweenSegments(result.routes[0]!.route[index]!, point, junction, junction)))
  expect({ connected: areNodePortPointPairsConnectedByRoutes(result.routes, node),
    copperGap: Math.max(0, trunkDistance - routes[0]!.traceThickness) }).toEqual({ connected: true, copperGap: 0 })
  expect(trunkDistance).toBeLessThanOrEqual(1e-9)
  expect(result.routes[0]!.route).toContainEqual(trunk[2]!)
  expect(junction).toEqual(branch[0]!)
  for (const [index, route] of result.routes.entries()) {
    expect(route.route[0]).toEqual(original[index]!.route[0]!)
    expect(route.route.at(-1)).toEqual(original[index]!.route.at(-1)!)
  }
  expect(routes).toEqual(original)
})
