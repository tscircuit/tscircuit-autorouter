import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { getConnectionPointLayers, type SimpleRouteConnection, type SimplifiedPcbTrace } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

type Point = { x: number; y: number }
type Primitive = { start: Point; end: Point; radius: number; layers: Set<number> }

/** Validate actual copper contact; trace IDs and connectsTo never join geometry. */
export function assertPhysicalForestConnectivity(params: {
  connections: SimpleRouteConnection[]
  traces: SimplifiedPcbTrace[]
  layerCount: number
  areSameNet: (name: string, other: string) => boolean
}): number {
  for (const connection of params.connections) {
    const primitives: Primitive[] = []
    for (const trace of params.traces) {
      if (!params.areSameNet(connection.name, trace.connection_name)) continue
      for (let index = 0; index < trace.route.length; index++) {
        const point = trace.route[index]!
        const next = trace.route[index + 1]
        if (point.route_type === "via") {
          const from = mapLayerNameToZ(point.from_layer, params.layerCount)
          const to = mapLayerNameToZ(point.to_layer, params.layerCount)
          const layers = new Set(Array.from({ length: Math.abs(from - to) + 1 }, (_, offset) => Math.min(from, to) + offset))
          primitives.push({ start: point, end: point, radius: (point.via_diameter ?? 0) / 2, layers })
        } else if (point.route_type === "wire" && next?.route_type === "wire" && point.layer === next.layer) {
          primitives.push({ start: point, end: next, radius: Math.min(point.width, next.width) / 2,
            layers: new Set([mapLayerNameToZ(point.layer, params.layerCount)]) })
        }
      }
    }
    const parents = primitives.map((_, index) => index)
    const root = (index: number): number => {
      while (parents[index] !== index) {
        parents[index] = parents[parents[index]!]!
        index = parents[index]!
      }
      return index
    }
    for (let first = 0; first < primitives.length; first++) {
      for (let second = 0; second < first; second++) {
        const a = primitives[first]!, b = primitives[second]!
        if ([...a.layers].some((layer) => b.layers.has(layer)) &&
          minimumDistanceBetweenSegments(a.start, a.end, b.start, b.end) <= a.radius + b.radius + 1e-6) {
          parents[root(first)] = root(second)
        }
      }
    }
    let requiredRoot: number | undefined
    for (const terminal of connection.pointsToConnect) {
      const layers = getConnectionPointLayers(terminal).map((layer) => mapLayerNameToZ(layer, params.layerCount))
      const touching = primitives.findIndex((primitive) => layers.some((layer) => primitive.layers.has(layer)) &&
        pointToSegmentDistance(terminal, primitive.start, primitive.end) <= primitive.radius + 1e-6)
      if (touching < 0 || (requiredRoot !== undefined && root(touching) !== requiredRoot)) {
        throw new Error(`Physical forest lost copper connectivity for terminal "${terminal.pointId ?? terminal.pcb_port_id}" on net "${connection.name}"`)
      }
      requiredRoot = root(touching)
    }
  }
  return params.connections.length
}
