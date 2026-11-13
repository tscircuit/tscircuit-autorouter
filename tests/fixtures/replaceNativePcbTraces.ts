import type { AnyCircuitElement, SourceTrace } from "circuit-json"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"

type PcbTraceId = string
type SourceTraceId = string

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
    const owners = circuitJson.filter(
      (element): element is SourceTrace =>
        element.type === "source_trace" &&
        (element.source_trace_id === trace.connection_name ||
          element.connected_source_net_ids?.includes(trace.connection_name) ===
            true),
    )
    if (owners.length !== 1) {
      throw new Error(`Expected one native owner for ${trace.connection_name}`)
    }
    ownerByTraceId.set(trace.pcb_trace_id, owners[0]!)
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
  return circuit
}
