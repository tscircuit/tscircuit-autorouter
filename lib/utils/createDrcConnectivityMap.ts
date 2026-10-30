import type { AnyCircuitElement } from "circuit-json"
import {
  type ConnectivityMap,
  getFullConnectivityMapFromCircuitJson,
} from "circuit-json-to-connectivity-map"

type CircuitJson = AnyCircuitElement[]
type CircuitJsonElement = CircuitJson[number]
type PcbViaWithTraceId = CircuitJsonElement & {
  type: "pcb_via"
  pcb_via_id: string
  pcb_trace_id: string
}

export const createDrcConnectivityMap = (
  circuitJson: CircuitJson,
): ConnectivityMap => {
  const connMap = getFullConnectivityMapFromCircuitJson(circuitJson)
  const viaTraceConnections = circuitJson
    .filter(
      (element): element is PcbViaWithTraceId =>
        element.type === "pcb_via" && typeof element.pcb_trace_id === "string",
    )
    .map((via) => [via.pcb_via_id, via.pcb_trace_id])

  connMap.addConnections(viaTraceConnections)
  return connMap
}
