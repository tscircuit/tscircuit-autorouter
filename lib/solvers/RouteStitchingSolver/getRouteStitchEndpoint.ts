import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import type { StitchTerminal } from "./getStitchTerminal"

export const getRouteStitchEndpoint = (
  route: HighDensityIntraNodeRoute,
  endpoint: "first" | "last",
): StitchTerminal => {
  const point = route.route[endpoint === "first" ? 0 : route.route.length - 1]
  if (!point) {
    throw new Error(
      `Route stitching received an empty route for "${route.connectionName}"`,
    )
  }
  const pcbPortId =
    endpoint === "first" ? route.startPcbPortId : route.endPcbPortId
  if (pcbPortId && point.pcb_port_id && pcbPortId !== point.pcb_port_id) {
    throw new Error(
      `Route stitching found conflicting PCB terminal identities on the ${endpoint} endpoint of "${route.connectionName}"`,
    )
  }
  return pcbPortId ? { ...point, pcb_port_id: pcbPortId } : point
}
