import { expect, test } from "bun:test"
import { legalizeHighDensityRouteProposal } from "lib/solvers/HighDensitySolver/legalizeHighDensityRouteProposal"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("selective projection skips fixed contact geometry without declaring it legal or impossible", () => {
  const routes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "a",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "b",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      vias: [],
    },
  ]
  const params = {
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
  }
  const selective = legalizeHighDensityRouteProposal({
    ...params,
    mode: "selective",
  })
  const full = legalizeHighDensityRouteProposal({ ...params, mode: "full" })
  expect(selective.stopReason).toBe("no-movable-conflicts")
  expect(selective.status).toBe("unchanged-needs-repair")
  expect(selective.movableConflictCount).toBe(0)
  expect(selective.immutableConflictCount).toBeGreaterThan(0)
  expect(selective.iterations).toBe(0)
  expect(selective.energyEvaluationCount).toBeLessThan(
    full.energyEvaluationCount,
  )
  expect(selective.routes).toEqual(full.routes)
  expect(selective.overlapPairsBefore).toBe(1)
  expect(selective.overlapPairsAfter).toBe(1)
})
