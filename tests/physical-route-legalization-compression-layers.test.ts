import { expect, test } from "bun:test"
import { legalizeHighDensityRouteProposal } from "lib/solvers/HighDensitySolver/legalizeHighDensityRouteProposal"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("compression distinguishes crossings on separate layers from a through-via junction", () => {
  const route: HighDensityIntraNodeRoute = { connectionName: "shared", traceThickness: 0.1, viaDiameter: 0.3,
    route: [-1, 0, 1].map((x) => ({ x, y: 0, z: 2, connectionName: "shared" })), vias: [] }
  const crossing: HighDensityIntraNodeRoute = { connectionName: "shared", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }], vias: [] }
  const params = { mode: "compression-only" as const, layerCount: 4, clearance: 0.1,
    node: { capacityMeshNodeId: "layers", center: { x: 0, y: 0 }, width: 4, height: 4, portPoints: [] } }
  const separate = legalizeHighDensityRouteProposal({ ...params, routes: [route, crossing] })
  expect(separate.routes[0]!.route).toEqual([route.route[0]!, route.route[2]!])
  const throughVia = { ...crossing, vias: [{ x: 0, y: 0 }] }
  const joined = legalizeHighDensityRouteProposal({ ...params, routes: [route, throughVia] })
  expect(joined.routes[0]!.route).toEqual(route.route)
  expect(joined.routes[1]!.vias).toEqual(throughVia.vias)
})
