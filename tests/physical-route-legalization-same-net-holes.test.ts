import { expect, test } from "bun:test"
import { legalizeHighDensityRouteProposal } from "lib/solvers/HighDensitySolver/legalizeHighDensityRouteProposal"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("same-net drill conflicts are projected even when no inter-net copper pair conflicts exist", () => {
  const routes: HighDensityIntraNodeRoute[] = [-1, 1].map((sign) => ({
    connectionName: `branch${sign}`,
    rootConnectionName: "shared",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: sign * 0.5, z: 0 },
      { x: 0, y: sign * 0.1, z: 0 },
      { x: 0, y: sign * 0.1, z: 1 },
      { x: 1, y: sign * 0.5, z: 1 },
    ],
    vias: [{ x: 0, y: sign * 0.1 }],
  }))
  const result = legalizeHighDensityRouteProposal({
    routes,
    mode: "selective",
    node: {
      capacityMeshNodeId: "test",
      center: { x: 0, y: 0 },
      width: 3,
      height: 3,
      portPoints: [],
    },
    layerCount: 2,
    clearance: 0.1,
    viaHoleDiameter: 0.15,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
  })
  expect(result.metricsRecorded).toBe(true)
  expect(result.copperPairsBefore).toBe(0)
  expect(result.holePairsBefore).toBe(1)
  expect(result.holePairsAfter).toBe(0)
  expect(result.status).toBe("clean")
  expect(result.iterations).toBeGreaterThan(0)
  const [a, b] = result.routes.map((route) => route.vias[0]!)
  expect(Math.hypot(a!.x - b!.x, a!.y - b!.y)).toBeGreaterThanOrEqual(0.25)
})
