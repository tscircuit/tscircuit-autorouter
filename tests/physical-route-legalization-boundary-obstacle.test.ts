import { expect, test } from "bun:test"
import { legalizeHighDensityRouteProposal } from "lib/solvers/HighDensitySolver/legalizeHighDensityRouteProposal"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("physical legalization includes obstacles outside the node by radius plus clearance", () => {
  const routes: HighDensityIntraNodeRoute[] = [
    { connectionName: "via-net", traceThickness: 0.1, viaDiameter: 0.3,
      route: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }], vias: [{ x: 1, y: 0 }] },
    { connectionName: "wire-net", traceThickness: 0.1, viaDiameter: 0.3,
      route: [{ x: -1, y: 0.22, z: 0 }, { x: 1, y: 0.22, z: 0 }], vias: [] },
  ]
  const params = { routes, node: { capacityMeshNodeId: "test", center: { x: 0, y: 0 }, width: 2, height: 2, portPoints: [] },
    layerCount: 2, clearance: 0.1, maxIterations: 0 }
  const withoutObstacle = legalizeHighDensityRouteProposal(params)
  const withObstacle = legalizeHighDensityRouteProposal({ ...params,
    obstacles: [{ type: "rect", center: { x: 1.32, y: 0 }, width: 0.2, height: 0.2, layers: ["top", "bottom"], connectedTo: [] }] })
  expect(withObstacle.lossBefore).toBeGreaterThan(withoutObstacle.lossBefore + 0.0001)
  expect(withObstacle.status).toBe("unchanged-needs-repair")
  expect(withObstacle.routes[0]!.vias).toEqual(routes[0]!.vias)
})
