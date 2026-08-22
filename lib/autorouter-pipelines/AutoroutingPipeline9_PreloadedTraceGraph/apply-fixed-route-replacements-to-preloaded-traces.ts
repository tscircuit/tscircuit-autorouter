import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import {
  materializeGeneratedThroughVias,
  shouldUseThroughVias,
  type ViaRoutePoint,
} from "lib/utils/materializeGeneratedThroughVias"
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
  allowBlindAndBuriedVias?: boolean
}

type ApplyFixedRouteReplacementsResult = {
  updatedPreloadedTraces: SimplifiedPcbTrace[]
  mutatedPreloadedTraces: SimplifiedPcbTrace[]
}

type OrdinaryTraceSection = {
  routePositionStart: number
  routePositionEnd: number
}

type ConvertUpdatedTraceRoutesParams = {
  trace: SimplifiedPcbTrace
  originalTraceRoutes: PreloadedHighDensityRoute[]
  updatedTraceRoutes: PreloadedHighDensityRoute[]
  replacedConnectionNames: ReadonlySet<string>
  layerCount: number
  defaultViaHoleDiameter: number
  obstacles: Obstacle[]
  connMap: ConnectivityMap
  allowBlindAndBuriedVias?: boolean
}

type RebuildThroughObstacleTraceParams = ConvertUpdatedTraceRoutesParams & {
  originalTraceRoutes: PreloadedHighDensityRoute[]
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

const routesHaveSameViaGeometry = (
  originalRoute: PreloadedHighDensityRoute,
  updatedRoute: PreloadedHighDensityRoute,
): boolean =>
  originalRoute.viaDiameter === updatedRoute.viaDiameter &&
  originalRoute.route.length === updatedRoute.route.length &&
  originalRoute.route.every((point, pointIndex) =>
    pointsAreEqual(point, updatedRoute.route[pointIndex]!),
  )

const getPreservedAuthoredVias = ({
  trace,
  originalTraceRoutes,
  updatedTraceRoutes,
  replacedConnectionNames,
}: Pick<
  ConvertUpdatedTraceRoutesParams,
  | "trace"
  | "originalTraceRoutes"
  | "updatedTraceRoutes"
  | "replacedConnectionNames"
>): ViaRoutePoint[] =>
  originalTraceRoutes.flatMap((originalRoute) => {
    if (replacedConnectionNames.has(originalRoute.connectionName)) return []
    const updatedRoute = updatedTraceRoutes.find(
      (candidate) =>
        candidate.connectionName === originalRoute.connectionName &&
        routesHaveSameViaGeometry(originalRoute, candidate),
    )
    if (!updatedRoute) return []
    const routePosition = originalRoute.preloadedRoutePositionStart
    if (
      routePosition === undefined ||
      routePosition !== originalRoute.preloadedRoutePositionEnd ||
      !Number.isInteger(routePosition)
    ) {
      return []
    }
    const routePoint = trace.route[routePosition]
    return routePoint?.route_type === "via" ? [routePoint] : []
  })

const viaSpansAreEqual = (
  first: ViaRoutePoint,
  second: ViaRoutePoint,
): boolean =>
  (first.from_layer === second.from_layer &&
    first.to_layer === second.to_layer) ||
  (first.from_layer === second.to_layer && first.to_layer === second.from_layer)

const convertUpdatedTraceRoutes = ({
  trace,
  originalTraceRoutes,
  updatedTraceRoutes,
  replacedConnectionNames,
  layerCount,
  defaultViaHoleDiameter,
  obstacles,
  connMap,
  allowBlindAndBuriedVias,
}: ConvertUpdatedTraceRoutesParams): SimplifiedPcbTrace["route"] => {
  if (updatedTraceRoutes.length === 0) {
    throw new Error(
      `Pipeline9 lost every fixed route for mutated trace "${trace.pcb_trace_id}"`,
    )
  }
  const combinedPoints: HighDensityRoute["route"] = []
  let traceThickness = 0
  let viaDiameter = 0
  let rootConnectionName: string | undefined
  for (const updatedTraceRoute of [...updatedTraceRoutes].sort(
    comparePreloadedRouteOrder,
  )) {
    appendConnectedRoute(combinedPoints, updatedTraceRoute)
    traceThickness = Math.max(traceThickness, updatedTraceRoute.traceThickness)
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
  const convertedRoute = convertHdRouteToSimplifiedRoute(
    combinedRoute,
    layerCount,
    {
      defaultViaHoleDiameter,
      obstacles,
      connMap,
    },
  )
  if (!shouldUseThroughVias(allowBlindAndBuriedVias)) return convertedRoute
  const preservedAuthoredVias = getPreservedAuthoredVias({
    trace,
    originalTraceRoutes,
    updatedTraceRoutes,
    replacedConnectionNames,
  })
  const remainingPreservedVias = [...preservedAuthoredVias]
  const routeWithAuthoredVias = convertedRoute.map((routePoint) => {
    if (routePoint.route_type !== "via") return routePoint
    const preservedViaIndex = remainingPreservedVias.findIndex(
      (preservedVia) =>
        Math.abs(routePoint.x - preservedVia.x) <= POINT_EPSILON &&
        Math.abs(routePoint.y - preservedVia.y) <= POINT_EPSILON &&
        viaSpansAreEqual(routePoint, preservedVia),
    )
    if (preservedViaIndex === -1) return routePoint
    return remainingPreservedVias.splice(preservedViaIndex, 1)[0]!
  })
  return materializeGeneratedThroughVias({
    inputTraces: [{ ...trace, route: preservedAuthoredVias }],
    outputTraces: [{ ...trace, route: routeWithAuthoredVias }],
    layerCount,
    allowBlindAndBuriedVias,
  })[0]!.route
}

const getOrdinaryTraceSections = (
  trace: SimplifiedPcbTrace,
): OrdinaryTraceSection[] => {
  const sections: OrdinaryTraceSection[] = []
  let routePositionStart = 0
  for (
    let routePosition = 0;
    routePosition < trace.route.length;
    routePosition++
  ) {
    if (trace.route[routePosition]?.route_type !== "through_obstacle") continue
    if (routePositionStart < routePosition) {
      sections.push({
        routePositionStart,
        routePositionEnd: routePosition - 1,
      })
    }
    routePositionStart = routePosition + 1
  }
  if (routePositionStart < trace.route.length) {
    sections.push({
      routePositionStart,
      routePositionEnd: trace.route.length - 1,
    })
  }
  return sections
}

const getRoutesWithinOrdinarySection = (
  routes: PreloadedHighDensityRoute[],
  section: OrdinaryTraceSection,
): PreloadedHighDensityRoute[] => {
  return routes.filter((route) => {
    if (route.isThroughObstacle === true) return false
    const routePositionStart = route.preloadedRoutePositionStart
    const routePositionEnd = route.preloadedRoutePositionEnd
    if (routePositionStart === undefined || routePositionEnd === undefined) {
      throw new Error(
        `Pipeline9 fixed route "${route.connectionName}" is missing route-position metadata`,
      )
    }
    const rangeStart = Math.min(routePositionStart, routePositionEnd)
    const rangeEnd = Math.max(routePositionStart, routePositionEnd)
    return (
      rangeStart >= section.routePositionStart - POINT_EPSILON &&
      rangeEnd <= section.routePositionEnd + POINT_EPSILON
    )
  })
}

const rebuildThroughObstacleTrace = ({
  trace,
  originalTraceRoutes,
  updatedTraceRoutes,
  replacedConnectionNames,
  layerCount,
  defaultViaHoleDiameter,
  obstacles,
  connMap,
  allowBlindAndBuriedVias,
}: RebuildThroughObstacleTraceParams): SimplifiedPcbTrace["route"] => {
  if (updatedTraceRoutes.length === 0) {
    throw new Error(
      `Pipeline9 lost every fixed route for mutated trace "${trace.pcb_trace_id}"`,
    )
  }
  const sections = getOrdinaryTraceSections(trace)
  const ordinaryUpdatedRoutes = updatedTraceRoutes.filter(
    (route) => route.isThroughObstacle !== true,
  )
  for (const route of ordinaryUpdatedRoutes) {
    const containingSectionCount = sections.filter((section) =>
      getRoutesWithinOrdinarySection([route], section).includes(route),
    ).length
    if (containingSectionCount !== 1) {
      throw new Error(
        `Pipeline9 fixed route "${route.connectionName}" crosses an immutable through-obstacle primitive`,
      )
    }
  }
  const rebuiltRoute: SimplifiedPcbTrace["route"] = []
  let nextOriginalRoutePosition = 0
  for (const section of sections) {
    rebuiltRoute.push(
      ...trace.route.slice(
        nextOriginalRoutePosition,
        section.routePositionStart,
      ),
    )
    const originalSectionRoutes = getRoutesWithinOrdinarySection(
      originalTraceRoutes,
      section,
    )
    const sectionRoutes = getRoutesWithinOrdinarySection(
      updatedTraceRoutes,
      section,
    )
    if (originalSectionRoutes.length > 0 && sectionRoutes.length === 0) {
      throw new Error(
        `Pipeline9 lost every fixed route for an ordinary section of mutated trace "${trace.pcb_trace_id}"`,
      )
    }
    rebuiltRoute.push(
      ...(sectionRoutes.length > 0
        ? convertUpdatedTraceRoutes({
            trace,
            originalTraceRoutes: originalSectionRoutes,
            updatedTraceRoutes: sectionRoutes,
            replacedConnectionNames,
            layerCount,
            defaultViaHoleDiameter,
            obstacles,
            connMap,
            allowBlindAndBuriedVias,
          })
        : trace.route.slice(
            section.routePositionStart,
            section.routePositionEnd + 1,
          )),
    )
    nextOriginalRoutePosition = section.routePositionEnd + 1
  }
  rebuiltRoute.push(...trace.route.slice(nextOriginalRoutePosition))
  return rebuiltRoute
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
  allowBlindAndBuriedVias,
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
    const updatedTraceRoutes = (
      updatedFixedRoutesByTraceIndex.get(traceIndex) ?? []
    ).sort(comparePreloadedRouteOrder)
    const hasThroughObstacle = trace.route.some(
      (routePoint) => routePoint.route_type === "through_obstacle",
    )
    const mutatedTrace: SimplifiedPcbTrace = {
      ...trace,
      __replaces_pcb_trace_id: trace.pcb_trace_id,
      route: hasThroughObstacle
        ? rebuildThroughObstacleTrace({
            trace,
            originalTraceRoutes,
            updatedTraceRoutes,
            replacedConnectionNames,
            layerCount,
            defaultViaHoleDiameter,
            obstacles,
            connMap,
            allowBlindAndBuriedVias,
          })
        : convertUpdatedTraceRoutes({
            trace,
            originalTraceRoutes,
            updatedTraceRoutes,
            replacedConnectionNames,
            layerCount,
            defaultViaHoleDiameter,
            obstacles,
            connMap,
            allowBlindAndBuriedVias,
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
