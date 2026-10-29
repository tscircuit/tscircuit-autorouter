import {
  getReadableNameForPcbPort,
  getReadableNameForPcbTrace,
} from "@tscircuit/circuit-json-util"
import { isPointInsidePolygon } from "@tscircuit/math-utils"
import type {
  AnyCircuitElement,
  PcbPlatedHole,
  PcbPort,
  PcbSmtPad,
  PcbTrace,
} from "circuit-json"
import { PcbConnectivityMap } from "circuit-json-to-connectivity-map"

type Point = { x: number; y: number }
type Pad = PcbSmtPad | PcbPlatedHole
type RoutePoint = PcbTrace["route"][number]
type PadMap = Map<string, Pad[]>

/** Pad shapes produced by convertToCircuitJson, including their boundaries. */
const pointIsInPad = (point: Point, pad: Pad): boolean => {
  if (pad.shape === "circle") {
    const radius =
      pad.type === "pcb_smtpad" ? pad.radius : pad.outer_diameter / 2
    return Math.hypot(point.x - pad.x, point.y - pad.y) <= radius
  }
  if (pad.type === "pcb_smtpad" && pad.shape === "rect") {
    return (
      Math.abs(point.x - pad.x) <= pad.width / 2 &&
      Math.abs(point.y - pad.y) <= pad.height / 2
    )
  }
  let width: number
  let height: number
  let rotation: number
  if (pad.type === "pcb_smtpad" && pad.shape === "rotated_rect") {
    width = pad.width
    height = pad.height
    rotation = pad.ccw_rotation ?? 0
  } else if ("rect_pad_width" in pad && "rect_pad_height" in pad) {
    width = pad.rect_pad_width
    height = pad.rect_pad_height
    rotation =
      "rect_ccw_rotation" in pad && typeof pad.rect_ccw_rotation === "number"
        ? pad.rect_ccw_rotation
        : 0
  } else {
    throw new Error(`Unsupported autorouting continuity pad shape: ${pad.shape}`)
  }
  const angle = (rotation * Math.PI) / 180
  const polygon = [
    { x: -width / 2, y: -height / 2 },
    { x: width / 2, y: -height / 2 },
    { x: width / 2, y: height / 2 },
    { x: -width / 2, y: height / 2 },
  ].map(({ x, y }) => ({
    x: pad.x + x * Math.cos(angle) - y * Math.sin(angle),
    y: pad.y + x * Math.sin(angle) + y * Math.cos(angle),
  }))
  for (let index = 0; index < polygon.length; index++) {
    const start = polygon[index]!
    const end = polygon[(index + 1) % polygon.length]!
    const dx = end.x - start.x
    const dy = end.y - start.y
    const cross = (point.y - start.y) * dx - (point.x - start.x) * dy
    const dot = (point.x - start.x) * dx + (point.y - start.y) * dy
    if (
      Math.abs(cross) <= 1e-9 &&
      dot >= -1e-9 &&
      dot <= dx * dx + dy * dy + 1e-9
    ) {
      return true
    }
  }
  return isPointInsidePolygon(point, polygon)
}

const routePointReferencesPort = (point: RoutePoint, portId: string): boolean => {
  if (point.route_type !== "wire") return false
  return (
    point.start_pcb_port_id === portId ||
    point.end_pcb_port_id === portId
  )
}

const getMissingConnectionCenter = (
  first: RoutePoint,
  last: RoutePoint,
  port: PcbPort,
  expectedPorts: PcbPort[],
  padsByPort: PadMap,
): Point => {
  const endpoints = [first, last]
  for (const endpoint of endpoints) {
    if (
      endpoint.route_type === "wire" &&
      routePointReferencesPort(endpoint, port.pcb_port_id)
    ) {
      return { x: endpoint.x, y: endpoint.y }
    }
  }
  for (let index = 0; index < endpoints.length; index++) {
    const endpoint = endpoints[index]!
    const other = endpoints[1 - index]!
    if (endpoint.route_type !== "wire" || other.route_type !== "wire") continue
    if (
      expectedPorts.some(
        (expectedPort) =>
          expectedPort.pcb_port_id !== port.pcb_port_id &&
          padsByPort
            .get(expectedPort.pcb_port_id)
            ?.some((pad) => pointIsInPad(endpoint, pad)),
      )
    ) {
      return { x: other.x, y: other.y }
    }
  }
  if (first.route_type === "wire" && last.route_type === "wire") {
    const nearest =
      Math.hypot(first.x - port.x, first.y - port.y) <=
      Math.hypot(last.x - port.x, last.y - port.y)
        ? first
        : last
    return { x: nearest.x, y: nearest.y }
  }
  for (const endpoint of endpoints) {
    if (endpoint.route_type === "wire") return { x: endpoint.x, y: endpoint.y }
  }
  const centers = endpoints.map(
    (point): Point =>
      point.route_type === "through_pad"
        ? {
            x: (point.start.x + point.end.x) / 2,
            y: (point.start.y + point.end.y) / 2,
          }
        : { x: point.x, y: point.y },
  )
  return {
    x: (centers[0]!.x + centers[1]!.x) / 2,
    y: (centers[0]!.y + centers[1]!.y) / 2,
  }
}

/** Validates routed endpoints and via alignment without invoking board-wide checks. */
export const checkTraceContinuity = (
  circuitJson: AnyCircuitElement[],
): Record<string, unknown>[] => {
  const errors: Record<string, unknown>[] = []
  const ports = circuitJson.filter((element) => element.type === "pcb_port")
  const traces = circuitJson.filter((element) => element.type === "pcb_trace")
  const sourceTraces = circuitJson.filter(
    (element) => element.type === "source_trace",
  )
  const sourceTraceById = new Map(
    sourceTraces.map((trace) => [trace.source_trace_id, trace]),
  )
  const padsByPort: PadMap = new Map()
  const pads = [
    ...circuitJson.filter((element) => element.type === "pcb_smtpad"),
    ...circuitJson.filter((element) => element.type === "pcb_plated_hole"),
  ]
  for (const pad of pads) {
    if (!pad.pcb_port_id) continue
    const portPads = padsByPort.get(pad.pcb_port_id)
    if (portPads) portPads.push(pad)
    else padsByPort.set(pad.pcb_port_id, [pad])
  }
  const connectivity = new PcbConnectivityMap(circuitJson)
  const checkedSourceTraceIds = new Set<string>()
  for (const trace of traces) {
    if (trace.route.length === 0) continue
    const first = trace.route[0]!
    const last = trace.route.at(-1)!
    const sourceTrace = sourceTraceById.get(trace.source_trace_id!)
    const expectedPorts = sourceTrace
      ? ports.filter((port) =>
          sourceTrace.connected_source_port_ids?.includes(port.source_port_id),
        )
      : []
    const traceName = getReadableNameForPcbTrace(circuitJson, trace.pcb_trace_id)
    const sourceTraceId =
      sourceTrace?.source_trace_id ||
      trace.source_trace_id ||
      `!${trace.pcb_trace_id}`
    const commonError = {
      type: "pcb_trace_error",
      error_type: "pcb_trace_error",
      source_trace_id: sourceTraceId,
      pcb_trace_id: trace.pcb_trace_id,
      pcb_component_ids: [],
    }
    for (let index = 1; index < trace.route.length - 1; index++) {
      const previous = trace.route[index - 1]!
      const current = trace.route[index]!
      const next = trace.route[index + 1]!
      if (
        current.route_type !== "via" ||
        previous.route_type !== "wire" ||
        next.route_type !== "wire"
      ) continue
      if (
        Math.abs(previous.x - current.x) < 0.01 &&
        Math.abs(previous.y - current.y) < 0.01 &&
        Math.abs(next.x - current.x) < 0.01 &&
        Math.abs(next.y - current.y) < 0.01
      ) continue
      errors.push({
        ...commonError,
        message: `Via in trace [${traceName}] is misaligned at position {x: ${current.x}, y: ${current.y}}.`,
        pcb_trace_error_id: `misaligned_via_${trace.pcb_trace_id}_${index}`,
        pcb_port_ids: [],
      })
    }
    if (sourceTrace && expectedPorts.length > 0) {
      if (checkedSourceTraceIds.has(sourceTrace.source_trace_id)) continue
      checkedSourceTraceIds.add(sourceTrace.source_trace_id)
    }
    const candidateTraces =
      expectedPorts.length > 0
        ? [
            ...connectivity.getAllTracesConnectedToTrace(trace.pcb_trace_id),
            ...traces.filter(
              (candidate) =>
                candidate.source_trace_id === sourceTrace?.source_trace_id,
            ),
          ]
        : []
    for (const port of expectedPorts) {
      const portPads = padsByPort.get(port.pcb_port_id)
      if (!portPads?.length) continue
      const connectedBySibling = candidateTraces.some((candidate) => {
        if (
          candidate.pcb_trace_id === trace.pcb_trace_id ||
          !candidate.source_trace_id
        ) return false
        const candidateSourceTrace = sourceTraceById.get(
          candidate.source_trace_id,
        )
        if (
          !sourceTrace ||
          (candidate.source_trace_id !== sourceTrace.source_trace_id &&
            !candidateSourceTrace?.connected_source_port_ids.includes(
              port.source_port_id,
            ))
        ) return false
        if (
          candidate.route.some((point) =>
            routePointReferencesPort(point, port.pcb_port_id),
          )
        ) return true
        return [candidate.route[0], candidate.route.at(-1)].some(
          (point) =>
            point?.route_type === "wire" &&
            portPads.some((pad) => pointIsInPad(point, pad)),
        )
      })
      if (connectedBySibling) continue
      if (
        [first, last].some(
          (point) =>
            point.route_type === "wire" &&
            portPads.some((pad) => pointIsInPad(point, pad)),
        )
      ) continue
      const portName = getReadableNameForPcbPort(
        circuitJson,
        port.pcb_port_id,
      ).replace("pcb_port", "")
      errors.push({
        ...commonError,
        message: `Trace [${traceName}] is missing a connection to ${portPads[0]!.type.replace(/pcb_/, "")}${portName}`,
        pcb_trace_error_id: `missing_connection_${trace.pcb_trace_id}_${port.pcb_port_id}`,
        center: getMissingConnectionCenter(
          first,
          last,
          port,
          expectedPorts,
          padsByPort,
        ),
        pcb_port_ids: [port.pcb_port_id],
      })
    }
    if (expectedPorts.length > 0) continue
    const firstConnected =
      first.route_type === "wire" &&
      [...padsByPort.values()].some((portPads) =>
        portPads.some((pad) => pointIsInPad(first, pad)),
      )
    const sameEndpoints =
      first.route_type === "wire" && last.route_type === "wire" &&
      Math.abs(first.x - last.x) < 0.01 && Math.abs(first.y - last.y) < 0.01
    for (const [index, endpoint] of [first, last].entries()) {
      if (endpoint.route_type !== "wire") continue
      if (index === 1 && sameEndpoints && !firstConnected) continue
      if (
        [...padsByPort.values()].some((portPads) =>
          portPads.some((pad) => pointIsInPad(endpoint, pad)),
        )
      ) continue
      errors.push({
        ...commonError,
        message: `Trace [${traceName}] has disconnected endpoint at (${endpoint.x.toFixed(2)}, ${endpoint.y.toFixed(2)})`,
        pcb_trace_error_id: `disconnected_endpoint_${trace.pcb_trace_id}_${index === 0 ? "start" : "end"}`,
        center: { x: endpoint.x, y: endpoint.y },
        pcb_port_ids: [],
      })
    }
  }
  return errors
}
