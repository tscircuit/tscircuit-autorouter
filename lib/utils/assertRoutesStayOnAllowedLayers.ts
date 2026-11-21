import type { SimplifiedPcbTraces } from "lib/types"
import type { AllowedLayersByConnection } from "./getAllowedLayersByConnection"
import { mapLayerNameToZ } from "./mapLayerNameToZ"

export function assertRoutesStayOnAllowedLayers(
  traces: SimplifiedPcbTraces,
  constraints: {
    allowedLayersByConnection: AllowedLayersByConnection
    layerCount: number
  },
): void {
  if (constraints.allowedLayersByConnection.size === 0) return
  for (const trace of traces) {
    const layers = constraints.allowedLayersByConnection.get(
      trace.connection_name,
    )
    if (!layers) continue
    for (let index = 1; index < trace.route.length; index++) {
      const from = trace.route[index - 1]!
      const to = trace.route[index]!
      if (
        from.route_type !== "wire" ||
        to.route_type !== "wire" ||
        from.layer !== to.layer
      ) {
        continue
      }
      if (from.x === to.x && from.y === to.y) continue
      if (!layers.has(mapLayerNameToZ(from.layer, constraints.layerCount))) {
        throw new Error(
          `Connection "${trace.connection_name}" routed wire on forbidden bus layer "${from.layer}"`,
        )
      }
    }
  }
}
