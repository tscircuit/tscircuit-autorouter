import type { SimpleRouteJson, SimplifiedPcbTrace } from "../../types"
import type { HybridCopperSnapshot } from "./transactional-copper-types"

export function copperSnapshotToSimpleRouteJson({
  input,
  copperSnapshot,
}: {
  input: SimpleRouteJson
  copperSnapshot: HybridCopperSnapshot
}): SimpleRouteJson {
  const preloadedTraceIds = new Set(
    (input.traces ?? []).map((trace) => trace.pcb_trace_id),
  )
  const isPreloadedCopperId = (copperId: string): boolean =>
    [...preloadedTraceIds].some((traceId) =>
      copperId.startsWith(`${traceId}:`),
    )
  const generatedSegmentTraces: SimplifiedPcbTrace[] = copperSnapshot.segments
    .filter((segment) => !isPreloadedCopperId(segment.copperId))
    .map((segment) => ({
      type: "pcb_trace",
      pcb_trace_id: `hybrid:${segment.copperId}`,
      connection_name: segment.connectionName,
      route: [
        {
          route_type: "wire",
          x: segment.start.x,
          y: segment.start.y,
          width: segment.widthMm,
          layer: segment.layer,
        },
        {
          route_type: "wire",
          x: segment.end.x,
          y: segment.end.y,
          width: segment.widthMm,
          layer: segment.layer,
        },
      ],
    }))
  const generatedViaTraces: SimplifiedPcbTrace[] = copperSnapshot.vias
    .filter((via) => !isPreloadedCopperId(via.copperId))
    .map((via) => ({
      type: "pcb_trace",
      pcb_trace_id: `hybrid:${via.copperId}`,
      connection_name: via.connectionName,
      route: [
        {
          route_type: "via",
          x: via.x,
          y: via.y,
          from_layer: via.fromLayer,
          to_layer: via.toLayer,
          via_diameter: via.padDiameterMm,
          via_hole_diameter: via.holeDiameterMm,
        },
      ],
    }))
  return {
    ...input,
    traces: [
      ...(input.traces ?? []).map((trace) => ({
        ...trace,
        route: trace.route.map((entry) => ({ ...entry })),
      })),
      ...generatedSegmentTraces,
      ...generatedViaTraces,
    ],
  }
}
