import type { SimplifiedPcbTraces } from "lib/types"
import type { AllowedZByConnectionName } from "lib/types/high-density-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

export const assertPipeline9TracesUseAllowedZ = ({
  traces,
  allowedZByConnectionName,
  layerCount,
}: {
  traces: SimplifiedPcbTraces
  allowedZByConnectionName: AllowedZByConnectionName
  layerCount: number
}): void => {
  for (const trace of traces) {
    const allowedZ = allowedZByConnectionName[trace.connection_name]
    if (!allowedZ) continue
    const disallowedWire = trace.route.find(
      (routePoint) =>
        routePoint.route_type === "wire" &&
        !allowedZ.includes(mapLayerNameToZ(routePoint.layer, layerCount)),
    )
    if (disallowedWire?.route_type !== "wire") continue
    throw new Error(
      `Pipeline9 routed "${trace.connection_name}" on disallowed layer "${disallowedWire.layer}"`,
    )
  }
}
