import { expect, test } from "bun:test"
import { legalizeHighDensityRouteProposal } from "lib/solvers/HighDensitySolver/legalizeHighDensityRouteProposal"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("a copper improvement cannot deepen an existing same-net drill conflict", () => {
  const routes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "a",
      rootConnectionName: "shared",
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
    {
      connectionName: "c",
      rootConnectionName: "shared",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: -0.8, z: 0 },
        { x: 0, y: -0.28, z: 0, pcb_port_id: "fixed-via" },
        { x: 0, y: -0.28, z: 1 },
        { x: 1, y: -0.8, z: 1 },
      ],
      vias: [{ x: 0, y: -0.28 }],
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
    viaHoleDiameter: 0.2,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
  })
  const a = result.routes[0]!.vias[0]!,
    c = result.routes[2]!.vias[0]!
  expect(Math.hypot(a.x - c.x, a.y - c.y)).toBeGreaterThanOrEqual(0.28 - 1e-8)
  expect(c).toEqual(routes[2]!.vias[0]!)
  expect(result.holePairsAfter).toBe(result.holePairsBefore)
  expect(result.status).not.toBe("clean")
})
