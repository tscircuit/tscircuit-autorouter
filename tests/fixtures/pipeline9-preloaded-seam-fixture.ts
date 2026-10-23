import type { ChangedPreloadedTraceSection, PreloadedTraceSectionEndpointWitness } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { SimpleRouteJson } from "lib/types"
import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

export function createPreloadedSeamFixture(clipped = false): {
  sourceSrj: SimpleRouteJson
  sections: ChangedPreloadedTraceSection[]
  witnesses: PreloadedTraceSectionEndpointWitness[]
  nodes: NodeWithPortPoints[]
  viaDiameter: number
} {
  const sourceSrj: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 }, obstacles: [],
    connections: [{ name: "original", pointsToConnect: [
      { x: -2, y: clipped ? -2 : 0, layer: "top" },
      { x: 2, y: clipped ? 2 : 0, layer: "top" },
    ] }],
    traces: [{ type: "pcb_trace", pcb_trace_id: "physical", connection_name: "original", route: [
      { route_type: "wire", x: -2, y: clipped ? -2 : 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: 2, y: clipped ? 2 : 0, layer: "top", width: 0.1 },
    ] }],
  }
  const root = getConnectivityMapFromSimpleRouteJson(sourceSrj).getNetConnectedToId("original")!
  const name = "mutable" as ChangedPreloadedTraceSection["connectionName"]
  const start = clipped ? { x: 0.02, y: 0.02, z: 0 } : { x: 0, y: 0, z: 0 }
  const end = clipped ? { x: -1, y: -1, z: 0 } : { x: 1, y: 0, z: 0 }
  const startPosition = clipped ? 0.505 : 0.5
  const endPosition = clipped ? 0.25 : 0.75
  const sourceStart = clipped ? { x: 0, y: 0.04, z: 0 } : { x: 0, y: 0.08, z: 0 }
  const sourceEnd = { ...end }
  const port = (id: string, point: typeof start): PortPoint => ({
    ...point, portPointId: id, connectionName: name, rootConnectionName: root,
  })
  const startPort = port("start-interface", sourceStart)
  const endPort = port("end-interface", sourceEnd)
  const nodes: NodeWithPortPoints[] = [{
    capacityMeshNodeId: "left", center: { x: -1, y: 0 }, width: 2, height: 4, availableZ: [0, 1],
    portPoints: clipped ? [startPort, endPort] : [startPort],
    portPointsInPairs: clipped ? [[startPort, endPort]] : undefined,
  }]
  if (!clipped) nodes.push({
    capacityMeshNodeId: "right", center: { x: 1, y: 0 }, width: 2, height: 4, availableZ: [0, 1],
    portPoints: [structuredClone(startPort), endPort],
    portPointsInPairs: [[structuredClone(startPort), endPort]],
  })
  const sections: ChangedPreloadedTraceSection[] = [{
    connectionName: name, traceId: "physical", startRoutePosition: startPosition, endRoutePosition: endPosition,
    connection: { name, __rootConnectionNames: [root], pointsToConnect: [
      { x: start.x, y: start.y, layer: "top" }, { x: end.x, y: end.y, layer: "top" },
    ] },
  }]
  const witnesses: PreloadedTraceSectionEndpointWitness[] = [0, 1].map((index) => ({
    connectionName: name, traceId: "physical", endpointIndex: index as 0 | 1,
    routePosition: index === 0 ? startPosition : endPosition,
    point: index === 0 ? start : end,
    rootConnectionName: root,
    portPointId: index === 0 ? "start-interface" : "end-interface",
    sourcePortPointId: index === 0 ? "source-start" : "source-end",
    sourcePortPoint: index === 0 ? sourceStart : sourceEnd,
    incidentCapacityMeshNodeIds: index === 0 ? ["left", "right"] : [clipped ? "left" : "right", "outside"],
  }))
  return { sourceSrj, sections, witnesses, nodes, viaDiameter: 0.3 }
}
