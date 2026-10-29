import { expect, test } from "bun:test"
import { legalizeHighDensityRouteProposal } from "lib/solvers/HighDensitySolver/legalizeHighDensityRouteProposal"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("missing drill dimensions remain unmeasured even after a supplied copper-rule clean check", () => {
  const routes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "a",
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
      connectionName: "b",
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
  })
  expect(result.status).toBe("clean")
  expect(result.drillMetricsRecorded).toBe(false)
  expect(result.holePairsBefore).toBeNull()
  expect(result.holePairsAfter).toBeNull()
  expect(result.independentCleanScope).toBe("copper-only")
})
