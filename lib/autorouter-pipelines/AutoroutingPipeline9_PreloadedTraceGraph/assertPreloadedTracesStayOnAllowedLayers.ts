import type { ConnectionName, TraceId } from "lib/types/srj-types"
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
  const allowedZLayersByTraceId = new Map<TraceId, ReadonlySet<number>>()
  const allowedZLayersByConnectionName = new Map<
    ConnectionName,
    ReadonlySet<number>
  >()
  for (const trace of preloadedTraces) {
    if (trace.isFixed || !trace.allowedLayers) continue
    const layers = new Set(
      trace.allowedLayers.map((layer) => mapLayerNameToZ(layer, layerCount)),
    )
    allowedZLayersByTraceId.set(trace.pcb_trace_id, layers)
    allowedZLayersByConnectionName.set(trace.connection_name, layers)
  }
  if (allowedZLayersByTraceId.size === 0) return

  for (const trace of traces) {
    const layers =
      allowedZLayersByTraceId.get(trace.pcb_trace_id) ??
      allowedZLayersByConnectionName.get(trace.connection_name)
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
