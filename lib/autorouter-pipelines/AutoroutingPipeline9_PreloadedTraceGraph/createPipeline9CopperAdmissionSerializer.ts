import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import type { PreloadedHighDensityRoute } from "./convertPreloadedTraceToHdRoutes"
import { getPipeline9RouteCopperGeometry } from "./pipeline9FixedRouteCopper"

type SerializerParams = {
  srj: SimpleRouteJson
  connMap: ConnectivityMap
}
type CopperAdmissionSerializer = {
  serialize: (
    routes: readonly HighDensityRoute[],
    publishedTraceIndexes?: ReadonlySet<number>,
  ) => SimplifiedPcbTrace[]
  canonicalOwnerByTraceId: ReadonlyMap<string, string>
  generatedTraceIds: ReadonlySet<string>
}

/** Project current high-density copper using the actual serialized publication rules. */
export const createPipeline9CopperAdmissionSerializer = ({
  srj,
  connMap,
}: SerializerParams): CopperAdmissionSerializer => {
  const dimensions = getViaDimensions(srj)
  const canonicalOwnerByTraceId = new Map<string, string>()
  const originalWidthByTrace = new Map<number, number>()
  for (const [index, trace] of (srj.traces ?? []).entries()) {
    const widths = trace.route.flatMap((point): number[] =>
      point.route_type === "wire" || point.route_type === "through_obstacle"
        ? [point.width]
        : [],
    )
    if (widths.length > 0) originalWidthByTrace.set(index, Math.max(...widths))
  }
  const generatedTraceIds = new Set<string>()
  const serialize = (
    routes: readonly HighDensityRoute[],
    publishedIndexes: ReadonlySet<number> = new Set(),
  ): SimplifiedPcbTrace[] => {
    const byTrace = new Map<string, SimplifiedPcbTrace>()
    const sectionKey = (route: PreloadedHighDensityRoute): string => {
      const position =
        route.preloadedRoutePositionStart ?? route.preloadedRouteIndex
      const section =
        srj.traces?.[route.preloadedTraceIndex]?.route.reduce(
          (count, point, index): number =>
            count +
            (point.route_type === "through_obstacle" && index < position ? 1 : 0),
          0,
        ) ?? 0
      return `${route.preloadedTraceIndex}:${section}`
    }
    const publishedViaDiameters = new Map<string, number>()
    for (const route of routes) {
      if (!("preloadedTraceIndex" in route)) continue
      const preload = route as PreloadedHighDensityRoute
      if (
        !publishedIndexes.has(preload.preloadedTraceIndex) ||
        preload.isThroughObstacle
      )
        continue
      const key = sectionKey(preload)
      publishedViaDiameters.set(
        key,
        Math.max(route.viaDiameter, publishedViaDiameters.get(key) ?? 0),
      )
    }
    for (const [index, input] of routes.entries()) {
      const preload =
        "preloadedTraceIndex" in input
          ? (input as PreloadedHighDensityRoute)
          : undefined
      const traceId = preload
        ? `preloaded:${preload.preloadedTraceIndex}`
        : `generated:${input.connectionName}:${
            input.regionId ??
            ("capacityMeshNodeId" in input
              ? input.capacityMeshNodeId
              : "regional")
          }:${index}`
      const original = preload
        ? srj.traces?.[preload.preloadedTraceIndex]
        : undefined
      if (preload && srj.traces && !original)
        throw new Error(
          "Copper admission fixed geometry lacks its original trace identity",
        )
      // Original serialized names are raw aliases. A routed canonical root is
      // already a net identity and must never pass through idToNetMap again.
      const canonicalRoot =
        input.rootConnectionName && connMap.netMap[input.rootConnectionName]
          ? input.rootConnectionName
          : undefined
      const owner = original
        ? connMap.getNetConnectedToId(original.connection_name)
        : (canonicalRoot ?? connMap.getNetConnectedToId(input.connectionName))
      if (
        !owner ||
        !connMap.netMap[owner] ||
        (canonicalRoot !== undefined && canonicalRoot !== owner)
      )
        throw new Error(
          `Copper admission geometry "${input.connectionName}" has inconsistent canonical ownership`,
        )
      if (!preload) generatedTraceIds.add(traceId)
      const previousOwner = canonicalOwnerByTraceId.get(traceId)
      if (previousOwner !== undefined && previousOwner !== owner)
        throw new Error(
          "Copper admission geometry changed its authoritative owner",
        )
      canonicalOwnerByTraceId.set(traceId, owner)
      const trace = byTrace.get(traceId) ?? {
        type: "pcb_trace" as const,
        pcb_trace_id: traceId,
        connection_name: input.rootConnectionName ?? input.connectionName,
        route: [],
      }
      const published =
        preload !== undefined &&
        !preload.isThroughObstacle &&
        publishedIndexes.has(preload.preloadedTraceIndex)
      const publishedWidth =
        published && preload
          ? originalWidthByTrace.get(preload.preloadedTraceIndex)
          : undefined
      const projected =
        publishedWidth === undefined
          ? input
          : {
              ...input,
              traceThickness: publishedWidth,
              viaDiameter: preload
                ? (publishedViaDiameters.get(sectionKey(preload)) ??
                  input.viaDiameter)
                : input.viaDiameter,
            }
      const geometry = getPipeline9RouteCopperGeometry(projected, srj)
      const originalPosition = preload?.preloadedRoutePositionStart
      const originalPoint =
        originalPosition !== undefined
          ? original?.route[Math.floor(originalPosition)]
          : undefined
      for (const wire of geometry.wireSegments) {
        // Independent typed primitives cannot acquire invented bridges when a
        // fixed family contains several separately clipped route fragments.
        trace.route.push({
          route_type: "through_obstacle",
          from_layer: mapZToLayerName(wire.z, srj.layerCount),
          to_layer: mapZToLayerName(wire.z, srj.layerCount),
          start: wire.start,
          end: wire.end,
          width:
            !published && originalPoint?.route_type === "wire"
              ? originalPoint.width
              : (wire.start.traceThickness ?? projected.traceThickness),
        })
      }
      for (const via of geometry.viaSpans) {
        if (preload?.isThroughObstacle) {
          trace.route.push({
            route_type: "through_obstacle",
            from_layer: mapZToLayerName(via.minZ, srj.layerCount),
            to_layer: mapZToLayerName(via.maxZ, srj.layerCount),
            start: via.center,
            end: via.center,
            width: via.diameter,
          })
          continue
        }
        const originalVia =
          preload && !published && originalPoint?.route_type === "via"
            ? originalPoint
            : undefined
        if (
          preload &&
          !published &&
          originalPosition !== undefined &&
          (!Number.isInteger(originalPosition) ||
            preload.preloadedRoutePositionEnd !== originalPosition ||
            !originalVia ||
            Math.hypot(
              originalVia.x - via.center.x,
              originalVia.y - via.center.y,
            ) > 1e-9 ||
            (originalVia.via_diameter ?? dimensions.padDiameter) !== via.diameter)
        )
          throw new Error(
            `Retained via in "${input.connectionName}" lost its indexed original physical identity`,
          )
        const holeDiameter = originalVia
          ? (originalVia.via_hole_diameter ?? dimensions.holeDiameter)
          : dimensions.holeDiameter
        trace.route.push({
          route_type: "via",
          ...via.center,
          from_layer:
            originalVia?.from_layer ?? mapZToLayerName(via.minZ, srj.layerCount),
          to_layer:
            originalVia?.to_layer ?? mapZToLayerName(via.maxZ, srj.layerCount),
          ...(originalVia?.layers ? { layers: originalVia.layers } : {}),
          via_diameter: via.diameter,
          via_hole_diameter: holeDiameter,
        })
      }
      byTrace.set(traceId, trace)
    }
    return [...byTrace.values()]
  }
  return { serialize, canonicalOwnerByTraceId, generatedTraceIds }
}
