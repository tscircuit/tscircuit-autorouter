import type { AnyCircuitElement, PcbTraceError } from "circuit-json"
import {
  getReadableNameForPcbPort,
  getReadableNameForPcbTrace,
} from "@tscircuit/circuit-json-util"
import { checkTracesAreContiguousNative } from "../../rust/capacity-autorouter-bindings/pkg/capacity_autorouter_bindings.js"
import { initializeAutorouterBindings } from "lib/bindings/initializeAutorouterBindings"

type PcbTrace = Extract<AnyCircuitElement, { type: "pcb_trace" }>
type PcbPort = Extract<AnyCircuitElement, { type: "pcb_port" }>

function projectElement(element: AnyCircuitElement): object {
  const source = element as unknown as Record<string, unknown>
  if (element.type === "pcb_trace") {
    return {
      type: element.type,
      pcb_trace_id: element.pcb_trace_id,
      source_trace_id: element.source_trace_id,
      route: element.route.map((point) => {
        const value = point as unknown as Record<string, unknown>
        const projected: Record<string, unknown> = {
          route_type: point.route_type,
          x: value.x,
          y: value.y,
          width: value.width,
          start_pcb_port_id: value.start_pcb_port_id,
          end_pcb_port_id: value.end_pcb_port_id,
        }
        if (point.route_type === "through_pad") {
          projected.start = { x: point.start.x, y: point.start.y }
          projected.end = { x: point.end.x, y: point.end.y }
        }
        return projected
      }),
    }
  }
  if (element.type === "pcb_port") {
    return {
      type: element.type,
      pcb_port_id: element.pcb_port_id,
      source_port_id: element.source_port_id,
      x: element.x,
      y: element.y,
    }
  }
  if (element.type === "source_trace") {
    return {
      type: element.type,
      source_trace_id: element.source_trace_id,
      connected_source_port_ids: element.connected_source_port_ids?.map(
        (id) => id,
      ),
    }
  }
  if (element.type === "pcb_smtpad" || element.type === "pcb_plated_hole") {
    if (!element.pcb_port_id)
      return { type: element.type, pcb_port_id: element.pcb_port_id }
    const projected: Record<string, unknown> = { type: element.type }
    for (const field of [
      "pcb_port_id",
      "shape",
      "x",
      "y",
      "radius",
      "width",
      "height",
      "ccw_rotation",
      "outer_diameter",
      "outer_width",
      "outer_height",
      "rect_pad_width",
      "rect_pad_height",
      "rect_ccw_rotation",
    ]) {
      if (field in source) {
        const value = source[field]
        projected[field] =
          value === undefined &&
          (field === "rect_pad_width" || field === "rect_pad_height")
            ? { $traceNumber: "NaN" }
            : value
      }
    }
    if (element.type === "pcb_smtpad" && element.shape === "polygon") {
      projected.points = element.points.map((point) => ({
        x: point.x,
        y: point.y,
      }))
    }
    return projected
  }
  return { type: element.type }
}

function encodeContiguityValue(value: unknown): unknown {
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) || Object.is(value, -0))
  ) {
    return { $traceNumber: Object.is(value, -0) ? "-0" : String(value) }
  }
  if (typeof value === "string") {
    const prefix = "\u0000trace-contiguity:"
    if (!/[\uD800-\uDFFF]/u.test(value) && !value.startsWith(prefix))
      return value
    let encoded = prefix
    for (let index = 0; index < value.length; index++) {
      encoded += value.charCodeAt(index).toString(16).padStart(4, "0")
    }
    return encoded
  }
  if (Array.isArray(value)) return value.map(encodeContiguityValue)
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      encodeContiguityValue(entry),
    ]),
  )
}

function decodeContiguityNumber(
  value: number | { $traceNumber: string },
): number {
  if (typeof value === "number") return value
  const tag = value.$traceNumber
  if (tag === "-0") return -0
  if (tag === "NaN") return NaN
  if (tag === "Infinity") return Infinity
  if (tag === "-Infinity") return -Infinity
  throw new Error(`Unknown native contiguity scalar ${tag}`)
}

export const checkTracesAreContiguous = (
  circuitJson: AnyCircuitElement[],
): PcbTraceError[] => {
  initializeAutorouterBindings()
  const input = circuitJson.map((element) =>
    encodeContiguityValue(projectElement(element)),
  )
  const descriptors = checkTracesAreContiguousNative(input)
  return descriptors.map((descriptor): PcbTraceError => {
    const trace = circuitJson[descriptor.traceIndex] as PcbTrace
    const sourceTrace =
      descriptor.sourceTraceIndex === undefined
        ? undefined
        : circuitJson[descriptor.sourceTraceIndex]
    const sourceTraceId =
      sourceTrace?.type === "source_trace"
        ? sourceTrace.source_trace_id
        : undefined
    const traceName = getReadableNameForPcbTrace(
      circuitJson,
      trace.pcb_trace_id,
    )
    if (descriptor.kind === "misalignedVia") {
      const point = trace.route[descriptor.pointIndex!]!
      if (point.route_type !== "via")
        throw new Error("Native contiguity error must refer to a via")
      return {
        type: "pcb_trace_error",
        message: `Via in trace [${traceName}] is misaligned at position {x: ${point.x}, y: ${point.y}}.`,
        source_trace_id:
          sourceTraceId || trace.source_trace_id || `!${trace.pcb_trace_id}`,
        error_type: "pcb_trace_error",
        pcb_trace_id: trace.pcb_trace_id,
        pcb_trace_error_id: `misaligned_via_${trace.pcb_trace_id}_${descriptor.pointIndex}`,
        pcb_component_ids: [],
        pcb_port_ids: [],
      }
    }
    if (descriptor.kind === "missingConnection") {
      const port = circuitJson[descriptor.portIndex!] as PcbPort
      const pad = circuitJson[descriptor.padIndex!]!
      const portName = getReadableNameForPcbPort(
        circuitJson,
        port.pcb_port_id,
      ).replace("pcb_port", "")
      const padType = pad.type.replace(/pcb_/, "")
      const centerPoint =
        descriptor.centerPointIndex === undefined
          ? undefined
          : trace.route[descriptor.centerPointIndex]
      if (centerPoint && centerPoint.route_type !== "wire")
        throw new Error("Missing connection center must refer to a wire")
      const center = centerPoint
        ? { x: centerPoint.x, y: centerPoint.y }
        : {
            x: decodeContiguityNumber(descriptor.center!.x),
            y: decodeContiguityNumber(descriptor.center!.y),
          }
      return {
        type: "pcb_trace_error",
        message: `Trace [${traceName}] is missing a connection to ${padType}${portName}`,
        source_trace_id:
          sourceTraceId || trace.source_trace_id || `!${trace.pcb_trace_id}`,
        error_type: "pcb_trace_error",
        pcb_trace_id: trace.pcb_trace_id,
        pcb_trace_error_id: `missing_connection_${trace.pcb_trace_id}_${port.pcb_port_id}`,
        center,
        pcb_component_ids: [],
        pcb_port_ids: [port.pcb_port_id],
      }
    }
    const point =
      trace.route[descriptor.endpoint === "start" ? 0 : trace.route.length - 1]!
    if (point.route_type !== "wire")
      throw new Error("Native disconnected endpoint must refer to a wire")
    return {
      type: "pcb_trace_error",
      message: `Trace [${traceName}] has disconnected endpoint at (${point.x.toFixed(2)}, ${point.y.toFixed(2)})`,
      source_trace_id:
        sourceTraceId || trace.source_trace_id || `!${trace.pcb_trace_id}`,
      error_type: "pcb_trace_error",
      pcb_trace_id: trace.pcb_trace_id,
      pcb_trace_error_id: `disconnected_endpoint_${trace.pcb_trace_id}_${descriptor.endpoint}`,
      center: { x: point.x, y: point.y },
      pcb_component_ids: [],
      pcb_port_ids: [],
    }
  })
}
