import { expect, test } from "bun:test"
import { legalizeHighDensityRouteProposal } from "lib/solvers/HighDensitySolver/legalizeHighDensityRouteProposal"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("compression retains an internal node terminal lacking pcb_port_id before moving its adjacent via", () => {
  const routes: HighDensityIntraNodeRoute[] = [
    { connectionName: "a", traceThickness: 0.1, viaDiameter: 0.3,
      route: [{ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0.5, y: 0, z: 0 },
        { x: 0.5, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }], vias: [{ x: 0.5, y: 0 }] },
    { connectionName: "b", traceThickness: 0.1, viaDiameter: 0.3,
      route: [{ x: -1, y: 0.22, z: 0 }, { x: 1, y: 0.22, z: 0 }], vias: [] },
  ]
  const result = legalizeHighDensityRouteProposal({ routes, node: { capacityMeshNodeId: "test", center: { x: 0, y: 0 },
    width: 3, height: 3, portPoints: [{ connectionName: "a", x: 0, y: 0, z: 0 }] }, layerCount: 2, clearance: 0.1 })
  expect(result.status).toBe("clean")
  expect(result.routes[0]!.route).toContainEqual({ x: 0, y: 0, z: 0 })
  expect(result.routes[0]!.vias[0]!.y).toBeLessThan(-0.079)
  expect(result.routes[0]!.route[0]).toEqual(routes[0]!.route[0])
  expect(result.routes[0]!.route.at(-1)).toEqual(routes[0]!.route.at(-1))
})
