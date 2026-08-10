import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import type { PreloadedHighDensityRoute } from "./convert-preloaded-traces-to-hd-routes"

type ApplyFixedRouteReplacementsParams = {
  originalTraces: SimplifiedPcbTrace[]
  originalFixedRoutes: PreloadedHighDensityRoute[]
  updatedFixedRoutes: PreloadedHighDensityRoute[]
  replacedConnectionNames: ReadonlySet<string>
  layerCount: number
  defaultViaHoleDiameter: number
  obstacles: Obstacle[]
  connMap: ConnectivityMap
}

type ApplyFixedRouteReplacementsResult = {
  updatedPreloadedTraces: SimplifiedPcbTrace[]
  mutatedPreloadedTraces: SimplifiedPcbTrace[]
}

const POINT_EPSILON = 1e-9

const pointsAreEqual = (
  a: HighDensityRoute["route"][number],
  b: HighDensityRoute["route"][number],
) =>
  Math.abs(a.x - b.x) <= POINT_EPSILON &&
  Math.abs(a.y - b.y) <= POINT_EPSILON &&
  a.z === b.z

const appendConnectedRoute = (
  combinedPoints: HighDensityRoute["route"],
  route: HighDensityRoute,
) => {
  if (combinedPoints.length === 0) {
    combinedPoints.push(...route.route)
    return
  }

  const previousEnd = combinedPoints.at(-1)!
  if (route.route[0] && pointsAreEqual(previousEnd, route.route[0])) {
    combinedPoints.push(...route.route.slice(1))
    return
  }
  if (route.route.at(-1) && pointsAreEqual(previousEnd, route.route.at(-1)!)) {
    combinedPoints.push(...route.route.slice(0, -1).reverse())
    return
  }

  throw new Error(
    `Pipeline9 could not reconnect mutated preloaded segment "${route.connectionName}"`,
  )
}

const comparePreloadedRouteOrder = (
  left: PreloadedHighDensityRoute,
  right: PreloadedHighDensityRoute,
) => {
  const leftStart = left.preloadedRoutePositionStart ?? left.preloadedRouteIndex
  const rightStart =
    right.preloadedRoutePositionStart ?? right.preloadedRouteIndex
  const leftEnd = left.preloadedRoutePositionEnd ?? leftStart
  const rightEnd = right.preloadedRoutePositionEnd ?? rightStart
  return (
    leftStart - rightStart ||
    leftEnd - rightEnd ||
    left.preloadedRouteIndex - right.preloadedRouteIndex ||
    left.connectionName.localeCompare(right.connectionName)
  )
}

const getMaximumOriginalTraceThickness = (
  trace: SimplifiedPcbTrace,
): number | undefined => {
  const traceWidths = trace.route.flatMap((routePoint) =>
    routePoint.route_type === "wire" ||
    routePoint.route_type === "through_obstacle"
      ? [routePoint.width]
      : [],
  )
  return traceWidths.length > 0 ? Math.max(...traceWidths) : undefined
}

/**
 * Rebuilds only the preloaded traces touched by a regional fallback. Untouched
 * traces retain their original serialized representation and PCB trace ids.
 */
export const applyFixedRouteReplacementsToPreloadedTraces = ({
  originalTraces,
  originalFixedRoutes,
  updatedFixedRoutes,
  replacedConnectionNames,
  layerCount,
  defaultViaHoleDiameter,
  obstacles,
  connMap,
}: ApplyFixedRouteReplacementsParams): ApplyFixedRouteReplacementsResult => {
  const originalFixedRoutesByTraceIndex = new Map<
    number,
    PreloadedHighDensityRoute[]
  >()
  const updatedFixedRoutesByTraceIndex = new Map<
    number,
    PreloadedHighDensityRoute[]
  >()

  for (const originalFixedRoute of originalFixedRoutes) {
    const traceRoutes =
      originalFixedRoutesByTraceIndex.get(
        originalFixedRoute.preloadedTraceIndex,
      ) ?? []
    traceRoutes.push(originalFixedRoute)
    originalFixedRoutesByTraceIndex.set(
      originalFixedRoute.preloadedTraceIndex,
      traceRoutes,
    )
  }
  for (const updatedFixedRoute of updatedFixedRoutes) {
    const traceRoutes =
      updatedFixedRoutesByTraceIndex.get(
        updatedFixedRoute.preloadedTraceIndex,
      ) ?? []
    traceRoutes.push(updatedFixedRoute)
    updatedFixedRoutesByTraceIndex.set(
      updatedFixedRoute.preloadedTraceIndex,
      traceRoutes,
    )
  }

  const mutatedPreloadedTraces: SimplifiedPcbTrace[] = []
  const updatedPreloadedTraces = originalTraces.map((trace, traceIndex) => {
    const originalTraceRoutes = (
      originalFixedRoutesByTraceIndex.get(traceIndex) ?? []
    ).sort(comparePreloadedRouteOrder)
    const traceWasMutated = originalTraceRoutes.some((route) =>
      replacedConnectionNames.has(route.connectionName),
    )
    if (!traceWasMutated) return trace
    if (
      trace.route.some(
        (routePoint) => routePoint.route_type === "through_obstacle",
      )
    ) {
      throw new Error(
        `Pipeline9 cannot yet rebuild mutated through-obstacle trace "${trace.pcb_trace_id}"`,
      )
    }

    const combinedPoints: HighDensityRoute["route"] = []
    let traceThickness = 0
    let viaDiameter = 0
    let rootConnectionName: string | undefined

    const updatedTraceRoutes = (
      updatedFixedRoutesByTraceIndex.get(traceIndex) ?? []
    ).sort(comparePreloadedRouteOrder)
    if (updatedTraceRoutes.length === 0) {
      throw new Error(
        `Pipeline9 lost every fixed route for mutated trace "${trace.pcb_trace_id}"`,
      )
    }

    for (const updatedTraceRoute of updatedTraceRoutes) {
      appendConnectedRoute(combinedPoints, updatedTraceRoute)
      traceThickness = Math.max(
        traceThickness,
        updatedTraceRoute.traceThickness,
      )
      viaDiameter = Math.max(viaDiameter, updatedTraceRoute.viaDiameter)
      rootConnectionName ??= updatedTraceRoute.rootConnectionName
    }

    const combinedRoute: HighDensityRoute = {
      connectionName: trace.connection_name,
      rootConnectionName,
      traceThickness: getMaximumOriginalTraceThickness(trace) ?? traceThickness,
      viaDiameter,
      route: combinedPoints,
      vias: combinedPoints.slice(0, -1).flatMap((point, pointIndex) => {
        const nextPoint = combinedPoints[pointIndex + 1]!
        return point.z !== nextPoint.z &&
          Math.abs(point.x - nextPoint.x) <= POINT_EPSILON &&
          Math.abs(point.y - nextPoint.y) <= POINT_EPSILON
          ? [{ x: nextPoint.x, y: nextPoint.y }]
          : []
      }),
    }
    const mutatedTrace: SimplifiedPcbTrace = {
      ...trace,
      __replaces_pcb_trace_id: trace.pcb_trace_id,
      route: convertHdRouteToSimplifiedRoute(combinedRoute, layerCount, {
        defaultViaHoleDiameter,
        obstacles,
        connMap,
      }),
    }
    mutatedPreloadedTraces.push(mutatedTrace)
    return mutatedTrace
  })

  return {
    updatedPreloadedTraces,
    mutatedPreloadedTraces,
  }
}
