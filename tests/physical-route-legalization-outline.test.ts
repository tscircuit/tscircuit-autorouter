import { expect, test } from "bun:test"
import { legalizeHighDensityRouteProposal } from "lib/solvers/HighDensitySolver/legalizeHighDensityRouteProposal"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("preexisting finite-width outline violations are pinned and never called clean", () => {
  const routes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "via-net",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 1 },
      ],
      vias: [{ x: 0, y: 0 }],
    },
    {
      connectionName: "wire-net",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0.22, z: 0 },
        { x: 1, y: 0.22, z: 0 },
      ],
      vias: [],
    },
  ]
  const result = legalizeHighDensityRouteProposal({
    routes,
    node: {
      capacityMeshNodeId: "test",
      center: { x: 0, y: 0 },
      width: 3,
      height: 3,
      portPoints: [],
    },
    layerCount: 2,
    clearance: 0.1,
    boardGeometry: {
      bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
      outline: [
        { x: -2, y: -2 },
        { x: 2, y: 2 },
        { x: 2, y: -2 },
      ],
      minBoardEdgeClearance: 0.1,
    },
  })
  expect(result.status).toBe("unchanged-needs-repair")
  expect(result.routes[0]!.vias).toEqual(routes[0]!.vias)
  expect(result.independentCleanCheckPassed).not.toBe(true)
  expect(result.routes[0]!.route).toEqual(routes[0]!.route)
})
