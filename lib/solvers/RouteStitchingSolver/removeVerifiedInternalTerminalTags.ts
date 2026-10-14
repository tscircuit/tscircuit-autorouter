import type { Point3 } from "@tscircuit/math-utils"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

type ConnectionName = string
type PcbPortId = string
type StitchTerminal = Point3 & { pcb_port_id?: PcbPortId }

export type ConnectionNamesByPcbPortId = Map<
  PcbPortId,
  Set<ConnectionName>
>

export function removeVerifiedInternalTerminalTags({
  bridgeConnectionNamesByPcbPortId,
  hdRoutes,
  start,
  end,
}: {
  bridgeConnectionNamesByPcbPortId: ConnectionNamesByPcbPortId
  hdRoutes: HighDensityIntraNodeRoute[]
  start: StitchTerminal
  end: StitchTerminal
}): HighDensityIntraNodeRoute[] {
  const endpointPcbPortIds = new Set<PcbPortId>()
  if (start.pcb_port_id) endpointPcbPortIds.add(start.pcb_port_id)
  if (end.pcb_port_id) endpointPcbPortIds.add(end.pcb_port_id)

  return hdRoutes.map((route) => {
    const routeWithEndpointTags = { ...route }
    if (
      routeWithEndpointTags.startPcbPortId &&
      !endpointPcbPortIds.has(routeWithEndpointTags.startPcbPortId) &&
      bridgeConnectionNamesByPcbPortId
        .get(routeWithEndpointTags.startPcbPortId)
        ?.has(route.connectionName)
    ) {
      delete routeWithEndpointTags.startPcbPortId
    }
    if (
      routeWithEndpointTags.endPcbPortId &&
      !endpointPcbPortIds.has(routeWithEndpointTags.endPcbPortId) &&
      bridgeConnectionNamesByPcbPortId
        .get(routeWithEndpointTags.endPcbPortId)
        ?.has(route.connectionName)
    ) {
      delete routeWithEndpointTags.endPcbPortId
    }
    return routeWithEndpointTags
  })
}
