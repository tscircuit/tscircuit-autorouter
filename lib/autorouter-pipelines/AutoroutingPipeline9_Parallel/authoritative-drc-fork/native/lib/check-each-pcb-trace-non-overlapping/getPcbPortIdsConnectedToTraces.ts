// Pinned from @tscircuit/checks 0.0.233 bundled source; see the authoritative-drc-fork LICENSE and PROVENANCE.md.
import type { PcbTrace } from "circuit-json"

export function getPcbPortIdsConnectedToRoutePoint(
  routePoint: PcbTrace["route"][number],
) {
  if (routePoint.route_type !== "wire") return []

  return [routePoint.start_pcb_port_id, routePoint.end_pcb_port_id].filter(
    (portId): portId is string => Boolean(portId),
  )
}

export function getPcbPortIdsConnectedToTrace(trace: PcbTrace) {
  const connectedPcbPorts = new Set<string>()
  for (const segment of trace.route) {
    for (const portId of getPcbPortIdsConnectedToRoutePoint(segment)) {
      connectedPcbPorts.add(portId)
    }
  }

  return Array.from(connectedPcbPorts)
}

export function getPcbPortIdsConnectedToTraces(traces: PcbTrace[]) {
  const connectedPorts = new Set<string>()
  for (const trace of traces) {
    for (const portId of getPcbPortIdsConnectedToTrace(trace)) {
      connectedPorts.add(portId)
    }
  }
  return Array.from(connectedPorts)
}
