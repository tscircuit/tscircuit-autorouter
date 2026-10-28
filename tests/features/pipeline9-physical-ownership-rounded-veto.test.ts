import { expect, test } from "bun:test"
import { arePipeline9NativeRoutesPhysicallyValid } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/arePipeline9NativeRoutesPhysicallyValid"
import { getPipeline9PhysicalOwnership, getPipeline9PhysicalRouteOwner } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("rounded coordinates cannot authorize foreign-pad or copper sharing", () => {
  const originalSrj: SimpleRouteJson = {
    layerCount: 4, minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    connections: [
      { name: "signal", pointsToConnect: [{ x: 0, y: 0, layer: "top", pcb_port_id: "signal-port" }] },
      { name: "ground", pointsToConnect: [{ x: 0.004, y: 0, layer: "top", pcb_port_id: "ground-port" }] },
    ],
    obstacles: [{ type: "rect", center: { x: 0.004, y: 0 }, width: 0.2, height: 0.2, layers: ["top"], connectedTo: ["ground"] }],
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(originalSrj)
  expect(connMap.areIdsConnected("signal", "ground")).toBeTrue()
  const physicalOwnership = getPipeline9PhysicalOwnership({ originalSrj, routingConnMap: connMap })
  expect(getPipeline9PhysicalRouteOwner(physicalOwnership, { connectionName: "signal" })).not.toBe(getPipeline9PhysicalRouteOwner(physicalOwnership, { connectionName: "ground" }))
  expect(physicalOwnership.diagnostics.ambiguousRoutingNetIds).toHaveLength(1)
  const route = {
    connectionName: "signal", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: -1, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 3 }, { x: 1, y: 0, z: 3 }],
    vias: [{ x: 0, y: 0 }],
  }
  const params = { routes: [route], connMap, layerCount: 4, traceClearance: 0.1, viaHoleDiameter: 0.15, minViaHoleEdgeToViaHoleEdgeClearance: 0.1, boardObstacles: originalSrj.obstacles, viaToPadClearance: 0.1 }
  expect(arePipeline9NativeRoutesPhysicallyValid(params)).toBeTrue()
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...params, physicalOwnership })).toBeFalse()
  const wire = { ...route, route: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], vias: [] }
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...params, routes: [wire] })).toBeTrue()
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...params, physicalOwnership, routes: [wire] })).toBeFalse()
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...params, routes: [wire, { ...wire, connectionName: "ground" }], boardObstacles: [] })).toBeTrue()
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...params, physicalOwnership, routes: [wire, { ...wire, connectionName: "ground" }], boardObstacles: [] })).toBeFalse()
})
