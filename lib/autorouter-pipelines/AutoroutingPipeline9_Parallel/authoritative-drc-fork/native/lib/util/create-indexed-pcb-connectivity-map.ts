import type { ReferenceDrcPrimitiveMemo } from "../../../ReferenceDrcPrimitiveMemo"
import { findOrderedIndexedConnectedNetworks } from "../../../findOrderedIndexedConnectedNetworks"
// Pinned from @tscircuit/checks 0.0.233 bundled source; see the authoritative-drc-fork LICENSE and PROVENANCE.md.
import { createTracePortLayerConnectivity } from "./trace-port-layer-connectivity"
import type { AnyCircuitElement } from "circuit-json"
import {
  ConnectivityMap,
  findConnectedNetworks,
  PcbConnectivityMap,
} from "circuit-json-to-connectivity-map"
import Flatbush from "flatbush"
import { getViaAndPourConnections } from "./get-via-and-pour-connections"

type TraceBounds = {
  traceIndex: number
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Physical trace connectivity, including plated via barrels and copper pours. */
export function createIndexedPcbConnectivityMap(
  circuitJson: AnyCircuitElement[],
  primitiveMemo?: ReferenceDrcPrimitiveMemo,
): PcbConnectivityMap {
  // Construct empty to avoid the dependency's all-pairs scan. Keep its exact
  // intersection predicate and query methods, including cross-net contacts.
  const map = new PcbConnectivityMap()
  map.circuitJson = circuitJson
  for (const element of circuitJson) {
    if (element.type === "pcb_trace") {
      map.traceIdToElm.set(element.pcb_trace_id, element)
    } else if (element.type === "pcb_port") {
      map.portIdToElm.set(element.pcb_port_id, element)
    }
  }
  const traces = [...map.traceIdToElm.values()]
  const boundsByLayer = new Map<string, TraceBounds[]>()
  for (const [traceIndex, trace] of traces.entries()) {
    const boundsForTrace = new Map<string, TraceBounds>()
    for (let i = 0; i < trace.route.length - 1; i++) {
      const a = trace.route[i]
      const b = trace.route[i + 1]
      if (
        a.route_type !== "wire" ||
        b.route_type !== "wire" ||
        a.layer !== b.layer
      )
        continue
      const bounds = boundsForTrace.get(a.layer) ?? {
        traceIndex,
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity,
      }
      // The exact predicate uses the first point's width for each segment.
      // A small conservative margin avoids excluding contacts at rounding boundaries.
      const radius = a.width / 2 + 1e-9
      bounds.minX = Math.min(bounds.minX, a.x - radius, b.x - radius)
      bounds.minY = Math.min(bounds.minY, a.y - radius, b.y - radius)
      bounds.maxX = Math.max(bounds.maxX, a.x + radius, b.x + radius)
      bounds.maxY = Math.max(bounds.maxY, a.y + radius, b.y + radius)
      boundsForTrace.set(a.layer, bounds)
    }
    for (const [layer, bounds] of boundsForTrace) {
      const entries = boundsByLayer.get(layer) ?? []
      entries.push(bounds)
      boundsByLayer.set(layer, entries)
    }
  }
  const candidates = traces.map(() => new Set<number>())
  for (const bounds of boundsByLayer.values()) {
    const index = new Flatbush(bounds.length)
    for (const box of bounds) index.add(box.minX, box.minY, box.maxX, box.maxY)
    index.finish()
    for (const box of bounds) {
      for (const hit of index.search(box.minX, box.minY, box.maxX, box.maxY)) {
        const other = bounds[hit].traceIndex
        if (other > box.traceIndex) candidates[box.traceIndex].add(other)
      }
    }
  }
  const connections: string[][] = []
  const traceGeometryIds = primitiveMemo ? traces.map((trace) => primitiveMemo.intern(trace)) : []
  // Preserve the original pair order for stable net IDs and diagnostics.
  for (const [i, neighbors] of candidates.entries()) {
    for (const j of [...neighbors].sort((a, b) => a - b)) {
      if (primitiveMemo
        ? primitiveMemo.getOrCompute("trace-pair", [traceGeometryIds[i], traceGeometryIds[j]],
            (): boolean => map._arePcbTracesConnected(traces[i], traces[j]))
        : map._arePcbTracesConnected(traces[i], traces[j])) {
        connections.push([traces[i].pcb_trace_id, traces[j].pcb_trace_id])
      }
    }
  }
  const layerConnectivity = createTracePortLayerConnectivity(circuitJson)
  const connectionsByPort = new Map<string, string[][]>()
  for (const trace of traces) {
    for (const point of trace.route) {
      if (point.route_type !== "wire") continue
      for (const portId of new Set([
        point.start_pcb_port_id,
        point.end_pcb_port_id,
      ])) {
        if (!portId || !map.portIdToElm.has(portId)) continue
        if (!layerConnectivity.canConnect(point, portId)) continue
        const entries = connectionsByPort.get(portId) ?? []
        entries.push(
          point.start_pcb_port_id === portId
            ? [portId, trace.pcb_trace_id]
            : [trace.pcb_trace_id, portId],
        )
        connectionsByPort.set(portId, entries)
      }
    }
  }
  for (const portId of map.portIdToElm.keys()) {
    for (const connection of connectionsByPort.get(portId) ?? [])
      connections.push(connection)
  }
  connections.push(...getViaAndPourConnections(circuitJson, primitiveMemo))
  map.connMap = new ConnectivityMap(primitiveMemo
    ? findOrderedIndexedConnectedNetworks(connections)
    : findConnectedNetworks(connections))
  return map
}
