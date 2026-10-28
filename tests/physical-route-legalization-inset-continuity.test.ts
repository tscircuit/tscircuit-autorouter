import { expect, test } from "bun:test"
import { legalizeHighDensityRouteProposal } from "lib/solvers/HighDensitySolver/legalizeHighDensityRouteProposal"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("an existing node inset violation cannot force a new drill conflict during every trial", () => {
  const routes: HighDensityIntraNodeRoute[] = [
    { connectionName: "a", rootConnectionName: "shared", traceThickness: 0.1, viaDiameter: 0.3,
      route: [{ x: -1, y: -0.2, z: 0 }, { x: 0.95, y: 0, z: 0 },
        { x: 0.95, y: 0, z: 1 }, { x: 1, y: -0.2, z: 1 }], vias: [{ x: 0.95, y: 0 }] },
    { connectionName: "b", traceThickness: 0.1, viaDiameter: 0.3,
      route: [{ x: -1, y: 0.22, z: 0 }, { x: 1, y: 0.22, z: 0 }], vias: [] },
    { connectionName: "c", rootConnectionName: "shared", traceThickness: 0.1, viaDiameter: 0.3,
      route: [{ x: -1, y: -0.8, z: 0 }, { x: 0.68, y: 0, z: 0, pcb_port_id: "fixed-via" },
        { x: 0.68, y: 0, z: 1 }, { x: 1, y: -0.8, z: 1 }], vias: [{ x: 0.68, y: 0 }] },
  ]
  const original = structuredClone(routes)
  const result = legalizeHighDensityRouteProposal({ routes, mode: "full", layerCount: 2, clearance: 0.1,
    viaHoleDiameter: 0.2, minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    node: { capacityMeshNodeId: "continuity", center: { x: 0, y: 0 }, width: 2, height: 2, portPoints: [] } })
  if (result.lossBefore === null || result.lossAfter === null) throw new Error("Fixture must record projection energy")
  expect(result.iterations).toBeGreaterThan(0)
  expect(result.lossAfter).toBeLessThan(result.lossBefore)
  expect(result.copperPairsAfter).toBeLessThan(result.copperPairsBefore!)
  expect(result.holePairsAfter).toBeLessThanOrEqual(result.holePairsBefore!)
  const movedVia = result.routes[0]!.vias[0]!, fixedVia = result.routes[2]!.vias[0]!
  expect(movedVia.y).toBeLessThan(0)
  expect(movedVia.x).toBeLessThanOrEqual(0.95 + 1e-9)
  expect(Math.hypot(movedVia.x - fixedVia.x, movedVia.y - fixedVia.y)).toBeGreaterThanOrEqual(0.27 - 1e-8)
  expect(fixedVia).toEqual(original[2]!.vias[0]!)
  expect(result.routes[0]!.route[0]).toEqual(original[0]!.route[0]!)
  expect(result.routes[0]!.route.at(-1)).toEqual(original[0]!.route.at(-1)!)
  expect(result.status).toBe("improved-needs-repair")
  expect(result.obstacleGuardRejected).toBe(false)
  expect(result.boardGuardRejected).toBe(false)
  expect(routes).toEqual(original)
})
