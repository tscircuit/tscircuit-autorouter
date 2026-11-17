import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { AnyCircuitElement, PcbTrace, PcbVia } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type {
  ConnectionPoint,
  NetId,
  PointId,
  SimpleRouteConnection,
} from "lib/types"
import { getConnectionPointLayers, isSingleLayerConnectionPoint } from "lib/types"
import RBush from "rbush"

type CopperId = PcbTrace["pcb_trace_id"] | PcbVia["pcb_via_id"]
type CopperContact = {
  id: CopperId
  layers: string[]
  start: { x: number; y: number }
  end: { x: number; y: number }
  radius: number
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function getCopperContacts(circuitJson: AnyCircuitElement[]): CopperContact[] {
  const contacts: CopperContact[] = []
  for (const element of circuitJson) {
    if (element.type === "pcb_via") {
      const radius = element.outer_diameter / 2
      contacts.push({
        id: element.pcb_via_id,
        layers: element.layers,
        start: element,
        end: element,
        radius,
        minX: element.x - radius,
        minY: element.y - radius,
        maxX: element.x + radius,
        maxY: element.y + radius,
      })
    }
    if (element.type !== "pcb_trace") continue
    for (const [index, start] of element.route.entries()) {
      if (start.route_type !== "wire") continue
      const next = element.route[index + 1]
      const end =
        next?.route_type === "wire" && next.layer === start.layer
          ? next
          : start
      const radius = start.width / 2
      contacts.push({
        id: element.pcb_trace_id,
        layers: [start.layer],
        start,
        end,
        radius,
        minX: Math.min(start.x, end.x) - radius,
        minY: Math.min(start.y, end.y) - radius,
        maxX: Math.max(start.x, end.x) + radius,
        maxY: Math.max(start.y, end.y) + radius,
      })
    }
  }
  return contacts
}

/** Declared external copper joins only routes that physically reach its anchors. */
export function createExternalCopperConnectionEvaluator(
  connections: SimpleRouteConnection[],
): (circuitJson: AnyCircuitElement[]) => CopperId[][] {
  const externalConnectivity = new ConnectivityMap({})
  const pointsById = new Map<PointId, ConnectionPoint>()
  for (const connection of connections) {
    externalConnectivity.addConnections(
      connection.externallyConnectedPointIds ?? [],
    )
    for (const point of connection.pointsToConnect) {
      if (point.pointId) pointsById.set(point.pointId, point)
    }
  }
  const anchors = [...pointsById].flatMap(([pointId, point]) => {
    const netId = externalConnectivity.getNetConnectedToId(pointId)
    if (netId === undefined) return []
    // A planned escape must reach the plane layer through emitted copper.
    const layers =
      isSingleLayerConnectionPoint(point) && point.terminalVia
        ? [point.terminalVia.toLayer]
        : getConnectionPointLayers(point)
    return [{ point, layers, netId }]
  })
  return (circuitJson): CopperId[][] => {
    if (anchors.length === 0) return []
    const copperIndex = new RBush<CopperContact>().load(
      getCopperContacts(circuitJson),
    )
    const copperByNet = new Map<NetId, Set<CopperId>>()
    for (const { point, layers, netId } of anchors) {
      for (const copper of copperIndex.search({
        minX: point.x - 1e-9,
        minY: point.y - 1e-9,
        maxX: point.x + 1e-9,
        maxY: point.y + 1e-9,
      })) {
        if (!layers.some((layer) => copper.layers.includes(layer))) continue
        if (
          pointToSegmentDistance(point, copper.start, copper.end) >
          copper.radius + 1e-9
        )
          continue
        if (!copperByNet.has(netId)) copperByNet.set(netId, new Set())
        copperByNet.get(netId)!.add(copper.id)
      }
    }
    return [...copperByNet.values()].map((ids) => [...ids])
  }
}
