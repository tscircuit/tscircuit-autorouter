import { expect, test } from "bun:test"
import { legalizeHighDensityRouteProposal } from "lib/solvers/HighDensitySolver/legalizeHighDensityRouteProposal"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("compression preserves owner transitions while allowing a consistently absent root owner", () => {
  const routes: HighDensityIntraNodeRoute[] = [0, 1, 2].map((y) => ({
    connectionName: "shared", traceThickness: 0.1, viaDiameter: 0.3, vias: [],
    route: [-1, 0, 1].map((x) => ({ x, y, z: 0, connectionName: y === 1 && x === 0 ? "transition" : "shared",
      ...(y === 2 && x === 0 ? { rootConnectionName: "root-transition" } : {}) })),
  }))
  const original = structuredClone(routes)
  const result = legalizeHighDensityRouteProposal({ routes, mode: "compression-only", layerCount: 2, clearance: 0.1,
    node: { capacityMeshNodeId: "owners", center: { x: 0, y: 1 }, width: 4, height: 4, portPoints: [] } })
  expect(result.routes[0]!.route).toEqual([routes[0]!.route[0]!, routes[0]!.route[2]!])
  expect(result.routes[1]!.route).toEqual(routes[1]!.route)
  expect(result.routes[2]!.route).toEqual(routes[2]!.route)
  expect(routes).toEqual(original)
})
