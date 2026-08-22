import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { UselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/UselessViaRemovalSolver"
import type { Obstacle, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { convertPreloadedTraceToHdRoutes } from "./convert-preloaded-traces-to-hd-routes"

type PreloadedTraceUpdates = {
  updatedPreloadedTraces: SimplifiedPcbTrace[]
  mutatedPreloadedTraces: SimplifiedPcbTrace[]
}

type MutableTraceRoute = {
  trace: SimplifiedPcbTrace
  hdRoute: HighDensityRoute
}

const POINT_EPSILON = 1e-9

const pointsAreEqual = (
  left: HighDensityRoute["route"][number],
  right: HighDensityRoute["route"][number],
) =>
  Math.abs(left.x - right.x) <= POINT_EPSILON &&
  Math.abs(left.y - right.y) <= POINT_EPSILON &&
  left.z === right.z

const pointsHaveSamePosition = (
  left: HighDensityRoute["route"][number],
  right: HighDensityRoute["route"][number],
) =>
  Math.abs(left.x - right.x) <= POINT_EPSILON &&
  Math.abs(left.y - right.y) <= POINT_EPSILON

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
    `Pipeline9 could not reconnect mutated preloaded trace "${route.connectionName}" for via cleanup`,
  )
}

const combinePreloadedTrace = ({
  trace,
  traceIndex,
  layerCount,
  defaultViaDiameter,
  connMap,
  originalTrace,
}: {
  trace: SimplifiedPcbTrace
  traceIndex: number
  layerCount: number
  defaultViaDiameter: number
  connMap: ConnectivityMap
  originalTrace?: SimplifiedPcbTrace
}): HighDensityRoute | null => {
  const fixedRoutes = convertPreloadedTraceToHdRoutes(
    trace,
    traceIndex,
    layerCount,
    defaultViaDiameter,
    connMap,
  )
  if (fixedRoutes.length === 0) return null

  const route: HighDensityRoute["route"] = []
  for (const fixedRoute of fixedRoutes) {
    appendConnectedRoute(route, fixedRoute)
  }

  const startPcbPortId = trace.connectsTo?.[0]
  const endPcbPortId = trace.connectsTo?.at(-1)
  if (startPcbPortId && route[0]) {
    route[0] = { ...route[0], pcb_port_id: startPcbPortId }
  }
  if (endPcbPortId && route.at(-1)) {
    route[route.length - 1] = {
      ...route.at(-1)!,
      pcb_port_id: endPcbPortId,
    }
  }

  const originalViaKeys = new Set(
    (originalTrace?.route ?? []).flatMap((routePoint) =>
      routePoint.route_type === "via"
        ? [
            `${routePoint.x}:${routePoint.y}:${Math.min(
              mapLayerNameToZ(routePoint.from_layer, layerCount),
              mapLayerNameToZ(routePoint.to_layer, layerCount),
            )}:${Math.max(
              mapLayerNameToZ(routePoint.from_layer, layerCount),
              mapLayerNameToZ(routePoint.to_layer, layerCount),
            )}`,
          ]
        : [],
    ),
  )
  for (let pointIndex = 0; pointIndex < route.length - 1; pointIndex++) {
    const point = route[pointIndex]!
    const nextPoint = route[pointIndex + 1]!
    if (point.z === nextPoint.z || !pointsHaveSamePosition(point, nextPoint)) {
      continue
    }
    const viaKey = `${point.x}:${point.y}:${Math.min(point.z, nextPoint.z)}:${Math.max(point.z, nextPoint.z)}`
    if (originalViaKeys.has(viaKey)) {
      route[pointIndex] = {
        ...point,
        toNextSegmentType: "through_obstacle",
      }
    }
  }

  return {
    connectionName: `pipeline9_mutated_preload_${traceIndex}`,
    rootConnectionName:
      fixedRoutes[0]!.rootConnectionName ??
      connMap.getNetConnectedToId(trace.connection_name) ??
      trace.connection_name,
    traceThickness: Math.max(
      ...fixedRoutes.map((fixedRoute) => fixedRoute.traceThickness),
    ),
    viaDiameter: Math.max(
      ...fixedRoutes.map((fixedRoute) => fixedRoute.viaDiameter),
    ),
    route,
    vias: route.slice(0, -1).flatMap((point, pointIndex) => {
      const nextPoint = route[pointIndex + 1]!
      return point.z !== nextPoint.z && pointsHaveSamePosition(point, nextPoint)
        ? [{ x: nextPoint.x, y: nextPoint.y }]
        : []
    }),
  }
}

/**
 * Removes collision-free layer round trips introduced while Pipeline9 reroutes
 * preloaded copper. Traces containing immutable through-obstacle or jumper
 * primitives stay fixed.
 */
export const removeUselessViasFromMutatedPreloadedTraces = ({
  updates,
  originalTraces,
  otherHdRoutes,
  collisionObstacles,
  routeConversionObstacles,
  colorMap,
  connMap,
  outline,
  layerCount,
  defaultViaDiameter,
  defaultViaHoleDiameter,
  traceClearance,
  obstacleClearance,
}: {
  updates: PreloadedTraceUpdates
  originalTraces: ReadonlyArray<SimplifiedPcbTrace>
  otherHdRoutes: ReadonlyArray<HighDensityRoute>
  collisionObstacles: ReadonlyArray<Obstacle>
  routeConversionObstacles: ReadonlyArray<Obstacle>
  colorMap: Record<string, string>
  connMap: ConnectivityMap
  outline?: ReadonlyArray<{ x: number; y: number }>
  layerCount: number
  defaultViaDiameter: number
  defaultViaHoleDiameter: number
  traceClearance: number
  obstacleClearance: number
}): PreloadedTraceUpdates => {
  const mutatedTraceIds = new Set(
    updates.mutatedPreloadedTraces.map((trace) => trace.pcb_trace_id),
  )
  const originalTraceById = new Map(
    originalTraces.map((trace) => [trace.pcb_trace_id, trace]),
  )
  const mutableTraceRoutes: MutableTraceRoute[] = []
  const fixedPreloadedRoutes: HighDensityRoute[] = []

  for (const [traceIndex, trace] of updates.updatedPreloadedTraces.entries()) {
    const isMutable =
      mutatedTraceIds.has(trace.pcb_trace_id) &&
      trace.route.every(
        (routePoint) =>
          routePoint.route_type === "wire" || routePoint.route_type === "via",
      )
    if (isMutable) {
      const hdRoute = combinePreloadedTrace({
        trace,
        traceIndex,
        layerCount,
        defaultViaDiameter,
        connMap,
        originalTrace: originalTraceById.get(
          trace.__replaces_pcb_trace_id ?? trace.pcb_trace_id,
        ),
      })
      if (hdRoute) mutableTraceRoutes.push({ trace, hdRoute })
      continue
    }

    fixedPreloadedRoutes.push(
      ...convertPreloadedTraceToHdRoutes(
        trace,
        traceIndex,
        layerCount,
        defaultViaDiameter,
        connMap,
      ),
    )
  }

  if (mutableTraceRoutes.length === 0) return updates

  const solver = new UselessViaRemovalSolver({
    unsimplifiedHdRoutes: mutableTraceRoutes.map(({ hdRoute }) => hdRoute),
    otherHdRoutes: [...otherHdRoutes, ...fixedPreloadedRoutes],
    obstacles: [...collisionObstacles],
    colorMap,
    layerCount,
    connMap,
    outline: outline ? [...outline] : undefined,
    layerMoveTraceMargin: traceClearance,
    layerMoveObstacleMargin: obstacleClearance,
    includeCopperRadiusInBroadPhase: true,
    protectMarkedTransitions: true,
    enableGeometryShortcuts: false,
    enableObstacleDetourShortcuts: false,
  })
  solver.solve()
  if (solver.failed) {
    throw new Error(
      `Pipeline9 failed to remove useless vias from mutated preloaded traces: ${solver.error ?? "unknown error"}`,
    )
  }

  const optimizedRoutes = solver.getOptimizedHdRoutes()
  if (
    !optimizedRoutes ||
    optimizedRoutes.length !== mutableTraceRoutes.length
  ) {
    throw new Error(
      `Pipeline9 via cleanup returned ${optimizedRoutes?.length ?? 0} routes for ${mutableTraceRoutes.length} mutated preloaded traces`,
    )
  }

  const cleanedTraceById = new Map<string, SimplifiedPcbTrace>()
  for (const [routeIndex, mutableTraceRoute] of mutableTraceRoutes.entries()) {
    const optimizedRoute = optimizedRoutes[routeIndex]!
    const routeWithoutProtectionMarkers: HighDensityRoute = {
      ...optimizedRoute,
      route: optimizedRoute.route.map((point) => {
        const cleanedPoint = { ...point }
        delete cleanedPoint.toNextSegmentType
        delete cleanedPoint.toNextSegmentCircuitJsonMetadata
        return cleanedPoint
      }),
    }
    cleanedTraceById.set(mutableTraceRoute.trace.pcb_trace_id, {
      ...mutableTraceRoute.trace,
      route: convertHdRouteToSimplifiedRoute(
        routeWithoutProtectionMarkers,
        layerCount,
        {
          defaultViaHoleDiameter,
          obstacles: [...routeConversionObstacles],
          connMap,
        },
      ),
    })
  }

  return {
    updatedPreloadedTraces: updates.updatedPreloadedTraces.map(
      (trace) => cleanedTraceById.get(trace.pcb_trace_id) ?? trace,
    ),
    mutatedPreloadedTraces: updates.mutatedPreloadedTraces.map(
      (trace) => cleanedTraceById.get(trace.pcb_trace_id) ?? trace,
    ),
  }
}
