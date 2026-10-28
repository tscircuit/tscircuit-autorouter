import { expect, test } from "bun:test"
import { legalizeHighDensityRouteProposal } from "lib/solvers/HighDensitySolver/legalizeHighDensityRouteProposal"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("physical legalization cannot gain clearance by driving a through via into an inner-layer obstacle", () => {
  const routes: HighDensityIntraNodeRoute[] = [
    { connectionName: "via-net", traceThickness: 0.1, viaDiameter: 0.3,
      route: [{ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 3 }, { x: 1, y: 0, z: 3 }],
      vias: [{ x: 0, y: 0 }] },
    { connectionName: "wire-net", traceThickness: 0.1, viaDiameter: 0.3,
      route: [{ x: -1, y: 0.22, z: 0 }, { x: 1, y: 0.22, z: 0 }], vias: [] },
  ]
  const result = legalizeHighDensityRouteProposal({ routes, node: { capacityMeshNodeId: "test", center: { x: 0, y: 0 },
    width: 3, height: 3, portPoints: [] }, layerCount: 4, clearance: 0.1,
    obstacles: [{ type: "rect", center: { x: 0, y: -0.4 }, width: 2, height: 0.2, layers: ["inner1"], connectedTo: [] }] })
  const via = result.routes[0]!.vias[0]!
  if (!result.metricsRecorded) throw new Error("Physical fixture must record its conflicts")
  expect(via.y).toBeGreaterThanOrEqual(-0.05 - 1e-8)
  expect(result.status).not.toBe("clean")
  expect(result.overlapPairsAfter).toBeLessThanOrEqual(result.overlapPairsBefore)
  expect(result.routes[0]!.route[0]).toEqual(routes[0]!.route[0])
  expect(result.routes[0]!.route.at(-1)).toEqual(routes[0]!.route.at(-1))
})
