import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { AnyCircuitElement, PcbTrace, PcbTraceError } from "circuit-json"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"

type WireRoutePoint = Extract<PcbTrace["route"][number], { route_type: "wire" }>

type TraceSegment = {
  trace: PcbTrace
  start: WireRoutePoint
  end: WireRoutePoint
}

const GEOMETRY_EPSILON = 1e-9

const getEndpointCopperWidth = (
  trace: PcbTrace,
  endpoint: "start" | "end",
): number | undefined => {
  if (trace.route_thickness_mode === "interpolated") return undefined

  let segmentStartIndex = endpoint === "start" ? 0 : trace.route.length - 2
  const indexStep = endpoint === "start" ? 1 : -1
  while (segmentStartIndex >= 0 && segmentStartIndex < trace.route.length - 1) {
    const start = trace.route[segmentStartIndex]
    const end = trace.route[segmentStartIndex + 1]
    if (
      start?.route_type !== "wire" ||
      end?.route_type !== "wire" ||
      start.layer !== end.layer
    ) {
      return undefined
    }
    if (Math.hypot(start.x - end.x, start.y - end.y) > GEOMETRY_EPSILON) {
      return start.width
    }
    segmentStartIndex += indexStep
  }

  return undefined
}

const getTraceSegmentsByNetAndLayer = (
  traces: PcbTrace[],
  connMap: ConnectivityMap,
) => {
  const segmentsByNetAndLayer = new Map<string, Map<string, TraceSegment[]>>()

  for (const trace of traces) {
    if (trace.route_thickness_mode === "interpolated") continue
    const netId = connMap.getNetConnectedToId(trace.pcb_trace_id)
    if (!netId) continue

    for (let index = 0; index < trace.route.length - 1; index += 1) {
      const start = trace.route[index]
      const end = trace.route[index + 1]
      if (
        start?.route_type !== "wire" ||
        end?.route_type !== "wire" ||
        start.layer !== end.layer ||
        Math.hypot(start.x - end.x, start.y - end.y) <= GEOMETRY_EPSILON
      ) {
        continue
      }

      const segmentsByLayer =
        segmentsByNetAndLayer.get(netId) ?? new Map<string, TraceSegment[]>()
      const segments = segmentsByLayer.get(start.layer) ?? []
      segments.push({ trace, start, end })
      segmentsByLayer.set(start.layer, segments)
      segmentsByNetAndLayer.set(netId, segmentsByLayer)
    }
  }

  return segmentsByNetAndLayer
}

export const filterDisconnectedEndpointsOnSameNetCopper = ({
  circuitJson,
  connMap,
  errors,
}: {
  circuitJson: AnyCircuitElement[]
  connMap: ConnectivityMap
  errors: PcbTraceError[]
}): PcbTraceError[] => {
  const traces = circuitJson.filter(
    (element): element is PcbTrace => element.type === "pcb_trace",
  )
  const traceById = new Map(traces.map((trace) => [trace.pcb_trace_id, trace]))
  const segmentsByNetAndLayer = getTraceSegmentsByNetAndLayer(traces, connMap)

  return errors.filter((error) => {
    const trace = traceById.get(error.pcb_trace_id)
    if (!trace) return true

    const endpoint = error.pcb_trace_error_id.endsWith("_start")
      ? "start"
      : error.pcb_trace_error_id.endsWith("_end")
        ? "end"
        : undefined
    if (
      !endpoint ||
      error.pcb_trace_error_id !==
        `disconnected_endpoint_${trace.pcb_trace_id}_${endpoint}`
    ) {
      return true
    }

    const point =
      endpoint === "start"
        ? trace.route[0]
        : trace.route[trace.route.length - 1]
    if (point?.route_type !== "wire") return true

    const endpointCopperWidth = getEndpointCopperWidth(trace, endpoint)
    const netId = connMap.getNetConnectedToId(trace.pcb_trace_id)
    if (endpointCopperWidth === undefined || !netId) return true

    const candidateSegments =
      segmentsByNetAndLayer.get(netId)?.get(point.layer) ?? []
    const touchesSameNetCopper = candidateSegments.some((segment) => {
      if (segment.trace.pcb_trace_id === trace.pcb_trace_id) return false
      const maximumContactDistance =
        endpointCopperWidth / 2 + segment.start.width / 2 + GEOMETRY_EPSILON
      return (
        pointToSegmentDistance(point, segment.start, segment.end) <=
        maximumContactDistance
      )
    })

    return !touchesSameNetCopper
  })
}
