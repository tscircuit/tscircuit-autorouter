import { expect, test } from "bun:test"
import { legalizeHighDensityRouteProposal } from "lib/solvers/HighDensitySolver/legalizeHighDensityRouteProposal"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("declared non-plated-hole clearance cannot be traded for a copper improvement", () => {
  const routes: HighDensityIntraNodeRoute[] = [
    { connectionName: "a", traceThickness: 0.1, viaDiameter: 0.3,
      route: [{ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }], vias: [{ x: 0, y: 0 }] },
    { connectionName: "b", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: -1, y: 0.22, z: 0 }, { x: 1, y: 0.22, z: 0 }], vias: [] },
  ]
  const result = legalizeHighDensityRouteProposal({ routes, mode: "selective",
    node: { capacityMeshNodeId: "test", center: { x: 0, y: 0 }, width: 3, height: 3, portPoints: [] },
    layerCount: 2, clearance: 0.1, minTraceToHoleEdgeClearance: 0.2,
    obstacles: [{ type: "rect", shape: "circle", isNonPlatedHole: true, center: { x: 0, y: -0.47 },
      width: 0.2, height: 0.2, layers: ["top", "bottom"], connectedTo: [] }] })
  const via = result.routes[0]!.vias[0]!
  const edgeGap = Math.hypot(via.x, via.y + 0.47) - 0.1 - 0.15
  expect(edgeGap).toBeGreaterThanOrEqual(0.2 - 1e-8)
  expect(result.status).not.toBe("clean")
  expect(result.independentCleanCheckPassed).not.toBe(true)
})
