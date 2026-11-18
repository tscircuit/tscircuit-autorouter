import type { AnyCircuitElement, SourceTrace } from "circuit-json"
import { checkTraceContinuity } from "lib/utils/autorouting-drc/checkTraceContinuity"

type SourceNetId = string

export function getNativeRoutedCircuitContinuityErrors(
  circuitJson: AnyCircuitElement[],
): ReturnType<typeof checkTraceContinuity> {
  const routedNetIds = new Set<SourceNetId>(
    circuitJson.flatMap((element) =>
      element.type === "pcb_trace" && element.source_trace_id
        ? [element.source_trace_id]
        : [],
    ),
  )
  const routedSourceTraces = [...routedNetIds].map(
    (sourceNetId): SourceTrace => {
      const members = circuitJson.filter(
        (element): element is SourceTrace =>
          element.type === "source_trace" &&
          (element.source_trace_id === sourceNetId ||
            element.connected_source_net_ids?.includes(sourceNetId) === true),
      )
      const firstMember = members[0]
      if (!firstMember) {
        throw new Error(`Missing native source for ${sourceNetId}`)
      }
      return {
        ...firstMember,
        source_trace_id: sourceNetId,
        connected_source_port_ids: [
          ...new Set(
            members.flatMap((trace) => trace.connected_source_port_ids),
          ),
        ],
      }
    },
  )
  const routedSourcePortIds = new Set(
    routedSourceTraces.flatMap((trace) => trace.connected_source_port_ids),
  )
  const routedPcbPortIds = new Set(
    circuitJson.flatMap((element) =>
      element.type === "pcb_port" &&
      routedSourcePortIds.has(element.source_port_id)
        ? [element.pcb_port_id]
        : [],
    ),
  )
  const routedCircuit = circuitJson.filter(
    (element) =>
      (element.type !== "pcb_smtpad" && element.type !== "pcb_plated_hole") ||
      (element.pcb_port_id !== undefined &&
        routedPcbPortIds.has(element.pcb_port_id)),
  )
  return checkTraceContinuity([...routedCircuit, ...routedSourceTraces])
}
