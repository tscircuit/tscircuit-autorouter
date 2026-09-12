import { getReadableNameForElement } from "@tscircuit/circuit-json-util"
import { midpoint } from "@tscircuit/math-utils"
import { all_layers, type AnyCircuitElement, type PcbViaTraceClearanceError } from "circuit-json"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { formatMm } from "format-si-unit"
import { encodeJsonInput, decodeJsonOutput } from "../../rust/tiny-hypergraph-bindings/ts/jsonWire"
import { checkViaTraceClearanceNative, type Point, type TraceSegment } from "../../rust/autorouter-bindings/pkg/autorouter_bindings.js"
import { initializeAutorouterBindings } from "./initializeAutorouterBindings"

type Options = { connMap: ConnectivityMap; minClearance?: number }

/** Projects the reference check's geometry; error messages retain the TS formatters. */
export function checkViaTraceClearance(
  circuitJson: AnyCircuitElement[],
  { connMap, minClearance }: Options,
): PcbViaTraceClearanceError[] {
  const vias = circuitJson.filter((element) => element.type === "pcb_via")
  const traces = circuitJson.filter((element) => element.type === "pcb_trace")
  const segments: TraceSegment[] = []
  const encodedStrings = new Map<string, string>()
  const originalStrings = new Map<string, string>()
  const netIdentities = new Map<unknown, string>()
  // Escape code units that cannot cross as Rust strings, including the escape
  // marker. Literal underscores preserve concatenated pair-key collisions.
  const encodeString = (value: string): string => {
    const previous = encodedStrings.get(value)
    if (previous !== undefined) return previous
    const encoded = value.replace(/[\\\u0000\uD800-\uDFFF]/g, (unit) =>
      `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`,
    )
    encodedStrings.set(value, encoded)
    originalStrings.set(encoded, value)
    return encoded
  }
  const netId = (id: string): string | undefined => {
    const net: unknown = connMap.getNetConnectedToId(id)
    if (!net) return undefined
    if (typeof net === "string") return encodeString(net)
    // Object-prototype keys can resolve to non-string identities in the TS map.
    if (!netIdentities.has(net)) netIdentities.set(net, `\u0000net:${netIdentities.size}`)
    return netIdentities.get(net)!
  }
  for (const trace of traces) {
    const routePoints = trace.route.flatMap((point): Point[] =>
      point.route_type === "through_pad"
        ? [point.start, point.end]
        : [{ x: point.x, y: point.y }],
    )
    const traceId = encodeString(trace.pcb_trace_id)
    const traceNetId = netId(trace.pcb_trace_id)
    const center = routePoints.length === 0 ? undefined : midpoint(routePoints[0]!, routePoints[routePoints.length - 1]!)
    for (let index = 0; index < trace.route.length - 1; index++) {
      const first = trace.route[index]!
      const second = trace.route[index + 1]!
      if (first.route_type !== "wire" || second.route_type !== "wire") continue
      if (first.layer !== second.layer) continue
      segments.push({
        pcb_trace_id: traceId,
        thickness: Number("width" in first ? first.width : "width" in second ? second.width : 0.1),
        layer: encodeString(first.layer),
        x1: first.x, y1: first.y, x2: second.x, y2: second.y,
        netId: traceNetId ?? null,
        center: center!,
      })
    }
  }
  if (vias.length === 0 || segments.length === 0) return []
  const board = circuitJson.find((element) => element.type === "pcb_board")
  minClearance ??= board?.min_trace_to_pad_edge_clearance ?? 0.1
  initializeAutorouterBindings()
  const violations = decodeJsonOutput(checkViaTraceClearanceNative(encodeJsonInput({
    vias: vias.map((via) => ({
      pcb_via_id: encodeString(via.pcb_via_id),
      x: via.x, y: via.y, outer_diameter: via.outer_diameter,
      layers: (Array.isArray(via.layers) ? via.layers : all_layers).map(encodeString),
      netId: netId(via.pcb_via_id),
    })),
    segments,
    minClearance,
  })))
  return violations.map((violation): PcbViaTraceClearanceError => {
    const viaId = originalStrings.get(violation.pcb_via_id)!
    const traceId = originalStrings.get(violation.pcb_trace_id)!
    return {
      type: "pcb_via_trace_clearance_error",
      pcb_via_trace_clearance_error_id: `via_trace_clearance_${viaId}_${traceId}`,
      error_type: "pcb_via_trace_clearance_error",
      message: `Via ${getReadableNameForElement(circuitJson, viaId)} and trace ${getReadableNameForElement(circuitJson, traceId)} are too close (clearance: ${formatMm(violation.actual_clearance)}, minimum: ${formatMm(violation.minimum_clearance)})`,
      pcb_via_id: viaId,
      pcb_trace_id: traceId,
      minimum_clearance: violation.minimum_clearance,
      actual_clearance: violation.actual_clearance,
      center: violation.center,
    }
  })
}
