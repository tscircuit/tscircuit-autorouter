import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { BoundaryPortKeepout } from "lib/solvers/UniformPortDistributionSolver/types"
import type { SimpleRouteJson } from "lib/types"
import { JUMPER_DIMENSIONS } from "lib/utils/jumperSizes"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import type { ChangedPreloadedTraceSection } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { convertPreloadedTraceToHdRoutes } from "./convertPreloadedTraceToHdRoutes"
import { removeChangedSectionsFromFixedHdRoutes } from "./materializeHypergraphPreloadedTraceSections"
import { getPipeline9RouteCopperGeometry } from "./pipeline9FixedRouteCopper"

/**
 * Builds clearance keepouts from the preloaded copper that remains immutable
 * after hypergraph pathing. Changed trace sections are omitted because their
 * original copper is removed before high-density routing.
 */
export const getPipeline9BoundaryPortKeepouts = ({
  srj,
  connMap,
  changedPreloadedTraceSections,
  defaultViaDiameter,
}: {
  srj: SimpleRouteJson
  connMap: ConnectivityMap
  changedPreloadedTraceSections: ChangedPreloadedTraceSection[]
  defaultViaDiameter: number
}): BoundaryPortKeepout[] => {
  const traces = srj.traces ?? []
  const fixedRoutes = removeChangedSectionsFromFixedHdRoutes({
    traces,
    fixedHdRoutes: traces.flatMap((trace, traceIndex) =>
      convertPreloadedTraceToHdRoutes(
        trace,
        traceIndex,
        srj.layerCount,
        defaultViaDiameter,
        connMap,
      ),
    ),
    sections: changedPreloadedTraceSections,
  })

  const routeKeepouts = fixedRoutes.flatMap((route, routeIndex) => {
    const geometry = getPipeline9RouteCopperGeometry(route)
    const connectedTo = [route.rootConnectionName ?? route.connectionName]
    const sourceTrace = traces[route.preloadedTraceIndex]
    const removablePreloadedTraceSection =
      sourceTrace &&
      route.preloadedRoutePositionStart !== undefined &&
      route.preloadedRoutePositionEnd !== undefined
        ? {
            traceId: sourceTrace.pcb_trace_id,
            startRoutePosition: route.preloadedRoutePositionStart,
            endRoutePosition: route.preloadedRoutePositionEnd,
          }
        : undefined
    return [
      ...geometry.wireSegments.map(
        (segment, segmentIndex): BoundaryPortKeepout => ({
          keepoutId: `fixed-route:${routeIndex}:wire:${segmentIndex}`,
          shape: "capsule",
          start: { x: segment.start.x, y: segment.start.y },
          end: { x: segment.end.x, y: segment.end.y },
          copperRadius: segment.width / 2,
          z: segment.z,
          connectedTo,
          portPathingReservation: route.isThroughObstacle
            ? "sampled-coordinate"
            : "full-edge",
          removablePreloadedTraceSection,
        }),
      ),
      ...geometry.viaSpans.flatMap((via, viaIndex) =>
        Array.from(
          { length: via.maxZ - via.minZ + 1 },
          (_, layerOffset): BoundaryPortKeepout => ({
            keepoutId: `fixed-route:${routeIndex}:via:${viaIndex}:z${via.minZ + layerOffset}`,
            shape: "capsule",
            start: via.center,
            end: via.center,
            copperRadius: via.diameter / 2,
            z: via.minZ + layerOffset,
            connectedTo,
            portPathingReservation: "sampled-coordinate",
            removablePreloadedTraceSection,
          }),
        ),
      ),
    ]
  })

  const jumperKeepouts = traces.flatMap((trace, traceIndex) => {
    const canonicalNetId =
      connMap.getNetConnectedToId(trace.connection_name) ??
      trace.connection_name
    return trace.route.flatMap((routePoint, routePointIndex) => {
      if (routePoint.route_type !== "jumper") return []
      const dimensions = JUMPER_DIMENSIONS[routePoint.footprint]
      const isHorizontal =
        Math.abs(routePoint.end.x - routePoint.start.x) >=
        Math.abs(routePoint.end.y - routePoint.start.y)
      const width = isHorizontal ? dimensions.padLength : dimensions.padWidth
      const height = isHorizontal ? dimensions.padWidth : dimensions.padLength
      const z = mapLayerNameToZ(routePoint.layer, srj.layerCount)
      return [routePoint.start, routePoint.end].map(
        (center, padIndex): BoundaryPortKeepout => ({
          keepoutId: `preloaded-trace:${traceIndex}:jumper:${routePointIndex}:pad:${padIndex}`,
          shape: "rect",
          center,
          width,
          height,
          z,
          connectedTo: [canonicalNetId],
          portPathingReservation: "sampled-coordinate",
        }),
      )
    })
  })

  return [...routeKeepouts, ...jumperKeepouts]
}
