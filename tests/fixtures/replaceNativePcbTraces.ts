import type { AnyCircuitElement, PcbPort, SourceTrace } from "circuit-json"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"

type PcbTraceId = string
type SourceTraceId = string
const PORT_POSITION_TOLERANCE_MM = 1e-6

function getNativeCopperOwner({
  circuitJson,
  connectionName,
}: {
  circuitJson: AnyCircuitElement[]
  connectionName: string
}): SourceTrace {
  const net = circuitJson.find(
    (element) =>
      element.type === "source_net" && element.source_net_id === connectionName,
  )
  const owners = circuitJson.filter(
    (element): element is SourceTrace =>
      element.type === "source_trace" &&
      (element.source_trace_id === connectionName ||
        element.connected_source_net_ids?.includes(connectionName) === true),
  )
  if (owners.length === 0 || (!net && owners.length !== 1)) {
    throw new Error(`Missing unambiguous native owner for ${connectionName}`)
  }
  if (owners.length === 1) return owners[0]!
  // Core also routes source nets whose members each attach one native port.
  return {
    ...owners[0]!,
    source_trace_id: connectionName,
    connected_source_port_ids: [
      ...new Set(owners.flatMap((owner) => owner.connected_source_port_ids)),
    ],
  }
}

/** Replace routed nets while retaining native pads, components and fixed copper. */
export const replaceNativePcbTraces = ({
  circuitJson,
  srj,
  traces,
}: {
  circuitJson: AnyCircuitElement[]
  srj: SimpleRouteJson
  traces: SimplifiedPcbTrace[]
}): AnyCircuitElement[] => {
  const ownerByTraceId = new Map<PcbTraceId, SourceTrace>()
  for (const trace of traces) {
    ownerByTraceId.set(
      trace.pcb_trace_id,
      getNativeCopperOwner({
        circuitJson,
        connectionName: trace.connection_name,
      }),
    )
  }
  const replacedSourceTraceIds = new Set<SourceTraceId>(
    [...ownerByTraceId.values()].map((source) => source.source_trace_id),
  )
  const replacedTraceIds = new Set<PcbTraceId>(
    circuitJson.flatMap((element) =>
      element.type === "pcb_trace" &&
      element.source_trace_id !== undefined &&
      replacedSourceTraceIds.has(element.source_trace_id)
        ? [element.pcb_trace_id]
        : [],
    ),
  )
  const circuit = circuitJson.filter((element) => {
    if (element.type === "pcb_trace") {
      return !replacedTraceIds.has(element.pcb_trace_id)
    }
    if (element.type === "pcb_via") {
      return !replacedTraceIds.has(element.pcb_trace_id!)
    }
    return true
  })
  for (const element of convertToCircuitJson(srj, traces)) {
    if (element.type !== "pcb_trace" && element.type !== "pcb_via") continue
    const source = ownerByTraceId.get(element.pcb_trace_id!)
    if (!source) throw new Error("Missing native copper owner")
    circuit.push(
      element.type === "pcb_trace"
        ? {
            ...element,
            source_trace_id: source.source_trace_id,
            subcircuit_id: source.subcircuit_id,
          }
        : {
            ...element,
            pcb_via_id: `routed_${element.pcb_via_id}`,
            subcircuit_id: source.subcircuit_id,
          },
    )
  }
  return circuit.map((element): AnyCircuitElement => {
    if (element.type !== "pcb_trace") return element
    if (!element.source_trace_id) {
      throw new Error("Missing native source for PCB port binding")
    }
    const source = getNativeCopperOwner({
      circuitJson,
      connectionName: element.source_trace_id,
    })
    const nativePorts = circuitJson.filter(
      (port): port is PcbPort =>
        port.type === "pcb_port" &&
        source.connected_source_port_ids.includes(port.source_port_id),
    )
    return {
      ...element,
      route: element.route.map((point, pointIndex) => {
        if (point.route_type !== "wire") return point
        const nativePort = nativePorts.find(
          (port) =>
            port.layers.includes(point.layer) &&
            Math.hypot(port.x - point.x, port.y - point.y) <=
              PORT_POSITION_TOLERANCE_MM,
        )
        // Bind only actual geometric terminal contacts to native port IDs.
        return {
          ...point,
          start_pcb_port_id:
            pointIndex === 0 ? nativePort?.pcb_port_id : undefined,
          end_pcb_port_id:
            pointIndex === element.route.length - 1
              ? nativePort?.pcb_port_id
              : undefined,
        }
      }),
    }
  })
}
