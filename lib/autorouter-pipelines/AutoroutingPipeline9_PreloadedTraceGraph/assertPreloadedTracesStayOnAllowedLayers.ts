import type { SimplifiedPcbTrace } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

export const assertPreloadedTracesStayOnAllowedLayers = ({
  traces,
  preloadedTraces,
  layerCount,
}: {
  traces: SimplifiedPcbTrace[]
  preloadedTraces: SimplifiedPcbTrace[]
  layerCount: number
}): void => {
  const allowedLayersByTraceId = new Map<
    SimplifiedPcbTrace["pcb_trace_id"],
    ReadonlySet<number>
  >()
  for (const trace of preloadedTraces) {
    if (trace.isFixed || !trace.allowedLayers) continue
    const layers = new Set(
      trace.allowedLayers.map((layer) => mapLayerNameToZ(layer, layerCount)),
    )
    allowedLayersByTraceId.set(trace.pcb_trace_id, layers)
    allowedLayersByTraceId.set(trace.connection_name, layers)
  }
  if (allowedLayersByTraceId.size === 0) return

  for (const trace of traces) {
    const layers =
      allowedLayersByTraceId.get(trace.pcb_trace_id) ??
      allowedLayersByTraceId.get(trace.connection_name)
    if (!layers) continue
    for (let index = 1; index < trace.route.length; index++) {
      const from = trace.route[index - 1]!
      const to = trace.route[index]!
      if (
        from.route_type !== "wire" ||
        to.route_type !== "wire" ||
        from.layer !== to.layer ||
        (from.x === to.x && from.y === to.y)
      ) {
        continue
      }
      if (!layers.has(mapLayerNameToZ(from.layer, layerCount))) {
        throw new Error("Native trace routed wire on a forbidden signal layer")
      }
    }
  }
}
