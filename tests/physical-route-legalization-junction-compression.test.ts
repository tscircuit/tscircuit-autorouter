import { expect, test } from "bun:test"
import { legalizeHighDensityRouteProposal } from "lib/solvers/HighDensitySolver/legalizeHighDensityRouteProposal"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("compression removes repeated owner labels while preserving geometric junctions and unknown identities", () => {
  const routes: HighDensityIntraNodeRoute[] = [
    { connectionName: "shared", rootConnectionName: "shared", traceThickness: 0.1, viaDiameter: 0.3,
      route: [-2, -1, 0, 1, 2].map((x) => ({ x, y: 0, z: 0, connectionName: "shared", rootConnectionName: "shared" })), vias: [] },
    { connectionName: "shared", rootConnectionName: "shared", traceThickness: 0.1, viaDiameter: 0.3,
      route: [0, 1].map((y) => ({ x: 0, y, z: 0, connectionName: "shared", rootConnectionName: "shared" })), vias: [] },
    { connectionName: "shared", rootConnectionName: "shared", traceThickness: 0.1, viaDiameter: 0.3,
      route: [-2, -1, 0, 1, 2].map((x) => ({ x, y: 2, z: 0, connectionName: "shared", rootConnectionName: "shared",
        ...(x === 1 ? { portPointId: "retained-identity" } : {}) })), vias: [] },
  ]
  const original = structuredClone(routes)
  for (const route of routes) {
    for (const point of route.route) Object.freeze(point)
    Object.freeze(route.route)
    Object.freeze(route.vias)
    Object.freeze(route)
  }
  Object.freeze(routes)
  const result = legalizeHighDensityRouteProposal({ routes, mode: "compression-only", layerCount: 2, clearance: 0.1,
    node: { capacityMeshNodeId: "junction", center: { x: 0, y: 0 }, width: 6, height: 6, portPoints: [] } })
  expect(result.status).toBe("compressed")
  expect(result.routes[0]!.route).toEqual([original[0]!.route[0]!, original[0]!.route[2]!, original[0]!.route[4]!])
  expect(result.routes[1]!.route).toEqual(original[1]!.route)
  expect(result.routes[2]!.route).toEqual([original[2]!.route[0]!, original[2]!.route[3]!, original[2]!.route[4]!])
  expect(result.pointsAfter).toBe(8)
  expect(routes).toEqual(original)
})
