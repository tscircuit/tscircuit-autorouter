import { expect, test } from "bun:test"
import { legalizeHighDensityRouteProposal } from "lib/solvers/HighDensitySolver/legalizeHighDensityRouteProposal"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("compression retains a near-coincident proposal junction and a repeated self junction", () => {
  const routes: HighDensityIntraNodeRoute[] = [
    { connectionName: "shared", traceThickness: 0.1, viaDiameter: 0.3, vias: [],
      route: [-2, -1, 0, 1, 2].map((x) => ({ x, y: 0, z: 0, connectionName: "shared" })) },
    { connectionName: "shared", traceThickness: 0.1, viaDiameter: 0.3, vias: [],
      route: [{ x: 5e-10, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }] },
    { connectionName: "self", traceThickness: 0.1, viaDiameter: 0.3, vias: [],
      route: [[-2, 2], [-1, 2], [0, 2], [0, 3], [-1, 3], [-1, 2], [-1, 1]]
        .map(([x, y]) => ({ x: x!, y: y!, z: 0 })) },
  ]
  const result = legalizeHighDensityRouteProposal({ routes, mode: "compression-only", layerCount: 2, clearance: 0.1,
    node: { capacityMeshNodeId: "near-junction", center: { x: 0, y: 1 }, width: 6, height: 6, portPoints: [] } })
  expect(result.routes[0]!.route).toEqual([routes[0]!.route[0]!, routes[0]!.route[2]!, routes[0]!.route[4]!])
  expect(result.routes[1]!.route).toEqual(routes[1]!.route)
  expect(result.routes[2]!.route).toEqual(routes[2]!.route)
})
