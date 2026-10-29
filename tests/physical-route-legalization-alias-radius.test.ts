import { expect, test } from "bun:test"
import { legalizeHighDensityRouteProposal } from "lib/solvers/HighDensitySolver/legalizeHighDensityRouteProposal"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("a shared XY vertex uses its widest copper radius during physical projection", () => {
  const routes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "a",
      rootConnectionName: "shared",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: -0.4, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 1, y: -0.4, z: 1 },
      ],
      vias: [{ x: 0, y: 0 }],
    },
    {
      connectionName: "b",
      rootConnectionName: "shared",
      traceThickness: 0.8,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: -0.4, z: 1 },
        { x: 0, y: 0, z: 1 },
        { x: 1, y: -0.4, z: 1 },
      ],
      vias: [],
    },
    {
      connectionName: "c",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0.4, z: 1 },
        { x: 1, y: 0.4, z: 1 },
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
      height: 1,
      portPoints: [],
    },
    layerCount: 2,
    clearance: 0.1,
  })
  const via = result.routes[0]!.vias[0]!
  expect(via.y).toBeGreaterThanOrEqual(-0.1 - 1e-8)
  expect(result.routes[1]!.route[1]!.y).toBe(via.y)
  expect(result.routes[1]!.traceThickness).toBe(0.8)
  expect(result.routes[0]!.viaDiameter).toBe(0.3)
})
