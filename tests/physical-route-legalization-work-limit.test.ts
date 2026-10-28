import { expect, test } from "bun:test"
import { legalizeHighDensityRouteProposal } from "lib/solvers/HighDensitySolver/legalizeHighDensityRouteProposal"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("selective deterministic work limits retain the explicit unresolved physical proposal", () => {
  const routes: HighDensityIntraNodeRoute[] = [
    { connectionName: "a", traceThickness: 0.1, viaDiameter: 0.3,
      route: [{ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }], vias: [{ x: 0, y: 0 }] },
    { connectionName: "b", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: -1, y: 0.22, z: 0 }, { x: 1, y: 0.22, z: 0 }], vias: [] },
  ]
  const result = legalizeHighDensityRouteProposal({ routes, mode: "selective", projectionWorkLimit: 0,
    node: { capacityMeshNodeId: "test", center: { x: 0, y: 0 }, width: 3, height: 3, portPoints: [] }, layerCount: 2, clearance: 0.1 })
  expect(result.stopReason).toBe("work-limit")
  expect(result.movableConflictCount).toBeGreaterThan(0)
  expect(result.iterations).toBe(0)
  expect(result.projectionWork).toBe(0)
  expect(result.status).toBe("unchanged-needs-repair")
  expect(result.routes).toEqual(routes)
})
