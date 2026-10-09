import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { NodeWithPortPoints, HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { createStraightRoutePreflightContext, getCertifiedStraightIntraNodeRoutes } from "lib/solvers/HyperHighDensitySolver/getCertifiedStraightIntraNodeRoutes"

const node: NodeWithPortPoints = {
  capacityMeshNodeId: "node", center: { x: 0, y: 0 }, width: 4, height: 4,
  availableZ: [0, 1],
  portPoints: [{ x: -2, y: 0, z: 0, connectionName: "a", rootConnectionName: "ra" }, { x: 2, y: 0, z: 0, connectionName: "a", rootConnectionName: "ra" }],
}
const certify = (obstacle: Obstacle, connMap?: ConnectivityMap, surroundingRoutes: HighDensityIntraNodeRoute[] = []): HighDensityIntraNodeRoute[] | null => {
  return getCertifiedStraightIntraNodeRoutes({
    nodeWithPortPoints: node, layerCount: 2, connMap, obstacles: [obstacle],
    boardGeometry: { bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 } },
    straightRoutePreflightContext: createStraightRoutePreflightContext({ minX: -2, maxX: 2, minY: -2, maxY: 2 }, { surroundingRoutes }),
  })
}

test("native pad layers and ownership preserve full exact clearance while holes remain unconditional", () => {
  const pad: Obstacle = { type: "rect", center: { x: 0, y: 0 }, width: 0.5, height: 0.5, layers: ["bottom"], connectedTo: ["pad"] }
  expect(certify(pad)).not.toBeNull()
  expect(certify({ ...pad, __zLayers: [0] })).toBeNull()
  expect(certify({ ...pad, layers: ["unknown"] })).toBeNull()
  const topPad = { ...pad, layers: ["top"] }
  const connected = new ConnectivityMap({ net: ["a", "pad", "ra", "b", "rb"] })
  expect(certify(topPad)).toBeNull()
  expect(certify({ ...topPad, __zLayers: [1] })).toBeNull()
  expect(certify({ ...pad, __zLayers: [1] })).not.toBeNull()
  expect(certify(topPad, connected)).not.toBeNull()
  expect(certify({ ...topPad, isNonPlatedHole: true }, connected)).toBeNull()
  expect(certify({ ...topPad, circuitJsonMetadata: { pcb_plated_hole_id: "pcb_plated_hole_1" } }, connected)).toBeNull()
  expect(certify({ ...pad, isNonPlatedHole: true }, connected)).toBeNull()
  const rectangle = { ...topPad, center: { x: 0, y: 0.5 }, width: 2, height: 0.1 }
  expect(certify(rectangle)).not.toBeNull()
  expect(certify({ ...rectangle, ccwRotationDegrees: 45 })).toBeNull()
  const prior: HighDensityIntraNodeRoute = { connectionName: "b", rootConnectionName: "rb", traceThickness: 0.15, viaDiameter: 0.3, route: [{ x: 0, y: -3, z: 0 }, { x: 0, y: 3, z: 0 }], vias: [] }
  expect(certify(pad, undefined, [prior])).toBeNull()
  expect(certify(pad, connected, [prior])).not.toBeNull()
  const getterMap = new ConnectivityMap({ net: ["a", "pad"] })
  let calls = 0
  Object.defineProperty(getterMap, "areIdsConnected", { get: () => { calls++; return connected.areIdsConnected } })
  expect(certify(topPad, getterMap)).toBeNull()
  expect(calls).toBe(0)
  const getterPad = { ...topPad }
  Object.defineProperty(getterPad, "connectedTo", { get: () => { calls++; return ["a"] } })
  expect(certify(getterPad, connected)).toBeNull()
  expect(calls).toBe(0)
})
