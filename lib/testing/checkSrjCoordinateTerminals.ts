import { pointToSegmentDistance, segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import type { PcbTraceError } from "circuit-json"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getConnectionPointLayers } from "lib/types/srj-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

type Point = { x: number; y: number }
type CoordinateTerminal = Point & { layers: string[]; connectionName: string; index: number }
type Copper = { a: Point; b: Point; radius: number; layers: string[]; traceId: string }
type TerminalError = PcbTraceError & { center: Point; pcb_trace_ids: string[] }
export type SrjCoordinateTerminalResult = {
  anchoredEndpointErrorIds: Set<string>
  errors: TerminalError[]
}
const CONTACT_EPSILON = 1e-9

/** Validate native point terminals without inventing a manufactured pad. */
export const checkSrjCoordinateTerminals = (
  srj: SimpleRouteJson,
  traces: readonly SimplifiedPcbTrace[],
): SrjCoordinateTerminalResult => {
  const anchoredEndpointErrorIds = new Set<string>()
  const errors: TerminalError[] = []
  if (!srj.connections.some(connection => connection.pointsToConnect.some(point => !point.pcb_port_id))) {
    return { anchoredEndpointErrorIds, errors }
  }
  const connectivity = getConnectivityMapFromSimpleRouteJson(srj)
  for (const connection of srj.connections) {
    if (connection.source_trace_id) {
      connectivity.addConnections([[connection.name, connection.source_trace_id]])
    }
  }
  const terminalsByNet = new Map<string, CoordinateTerminal[]>()
  for (const connection of srj.connections) {
    const net = connectivity.getNetConnectedToId(connection.name)!
    const terminals = terminalsByNet.get(net) ?? []
    connection.pointsToConnect.forEach((point, index) => {
      if (point.pcb_port_id) return
      terminals.push({ x: point.x, y: point.y, layers: getConnectionPointLayers(point), connectionName: connection.name, index })
    })
    if (terminals.length > 0) terminalsByNet.set(net, terminals)
  }
  const viaDimensions = getViaDimensions(srj)
  const stack = Array.from({ length: srj.layerCount }, (_, z) => mapZToLayerName(z, srj.layerCount))
  for (const [net, terminals] of terminalsByNet) {
    const netTraces = traces.filter(trace => connectivity.getNetConnectedToId(trace.connection_name) === net)
    // An entirely unrouted net is not a pre-existing baseline DRC error.
    if (netTraces.length === 0) continue
    const copper: Copper[] = []
    for (const trace of netTraces) {
      for (let index = 0; index < trace.route.length; index++) {
        const point = trace.route[index]!
        const previous = trace.route[index - 1]
        if (point.route_type === "wire") {
          copper.push({
            a: previous?.route_type === "wire" && previous.layer === point.layer ? previous : point,
            b: point, radius: Math.max(point.width, previous?.route_type === "wire" && previous.layer === point.layer ? previous.width : point.width) / 2,
            layers: [point.layer], traceId: trace.pcb_trace_id,
          })
        } else if (point.route_type === "via") {
          const from = mapLayerNameToZ(point.from_layer, srj.layerCount)
          const to = mapLayerNameToZ(point.to_layer, srj.layerCount)
          copper.push({
            a: point, b: point, radius: (point.via_diameter ?? viaDimensions.padDiameter) / 2,
            layers: srj.allowBlindAndBuriedVias ? point.layers ?? stack.slice(Math.min(from, to), Math.max(from, to) + 1) : stack,
            traceId: trace.pcb_trace_id,
          })
        }
      }
      for (const [side, point] of [["start", trace.route[0]], ["end", trace.route.at(-1)]] as const) {
        if (point?.route_type !== "wire") continue
        if (terminals.some(terminal => terminal.layers.includes(point.layer) && Math.hypot(point.x - terminal.x, point.y - terminal.y) <= point.width / 2 + CONTACT_EPSILON)) {
          anchoredEndpointErrorIds.add(`disconnected_endpoint_${trace.pcb_trace_id}_${side}`)
        }
      }
    }
    const parents = copper.map((_, index) => index)
    const root = (index: number): number => {
      let current = index
      while (parents[current] !== current) current = parents[current]!
      while (parents[index] !== index) {
        const next = parents[index]!
        parents[index] = current
        index = next
      }
      return current
    }
    for (let first = 0; first < copper.length; first++) {
      const a = copper[first]!
      for (let second = first + 1; second < copper.length; second++) {
        const b = copper[second]!
        if (!a.layers.some(layer => b.layers.includes(layer))) continue
        if (segmentToSegmentMinDistance(a.a, a.b, b.a, b.b) <= a.radius + b.radius + CONTACT_EPSILON) {
          parents[root(second)] = root(first)
        }
      }
    }
    let commonComponents: Set<number> | undefined
    for (const terminal of terminals) {
      const touchingComponents = new Set<number>()
      copper.forEach((shape, index) => {
        if (shape.layers.some(layer => terminal.layers.includes(layer)) && pointToSegmentDistance(terminal, shape.a, shape.b) <= shape.radius + CONTACT_EPSILON) {
          touchingComponents.add(root(index))
        }
      })
      commonComponents = commonComponents === undefined ? touchingComponents : new Set([...commonComponents].filter(component => touchingComponents.has(component)))
      if (touchingComponents.size > 0 && commonComponents.size > 0) continue
      const traceId = netTraces[0]!.pcb_trace_id
      errors.push({
        type: "pcb_trace_error", error_type: "pcb_trace_error",
        pcb_trace_error_id: `srj_coordinate_terminal_${terminal.connectionName}_${terminal.index}`,
        pcb_trace_id: traceId, pcb_trace_ids: netTraces.map(trace => trace.pcb_trace_id),
        source_trace_id: terminal.connectionName, pcb_component_ids: [], pcb_port_ids: [],
        center: { x: terminal.x, y: terminal.y },
        message: touchingComponents.size === 0
          ? `Trace "${traceId}" misses native SRJ coordinate terminal on ${terminal.layers.join(", ")}`
          : `Trace "${traceId}" leaves native SRJ coordinate terminals in disconnected copper components`,
      })
    }
  }
  return { anchoredEndpointErrorIds, errors }
}
