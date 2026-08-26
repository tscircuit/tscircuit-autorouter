import { distance } from "@tscircuit/math-utils"
import type { ChangedPreloadedTraceSection } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectionPointLayer } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import type { PreloadedHighDensityRoute } from "./convert-preloaded-traces-to-hd-routes"

type RoutePositionRange = {
  start: number
  end: number
}

const ROUTE_POSITION_EPSILON = 1e-9
const ENDPOINT_POSITION_EPSILON = 1e-6

const getSectionEndpoints = (
  section: ChangedPreloadedTraceSection,
  layerCount: number,
): [HighDensityRoute["route"][number], HighDensityRoute["route"][number]] => {
  const endpoints = section.connection.pointsToConnect.map((point) => ({
    x: point.x,
    y: point.y,
    z: mapLayerNameToZ(getConnectionPointLayer(point), layerCount),
  }))
  if (!endpoints[0] || !endpoints[1]) {
    throw new Error(
      `Pipeline9 changed section "${section.connectionName}" is missing an endpoint`,
    )
  }
  return [endpoints[0], endpoints[1]]
}

const getEndpointAlignment = ({
  route,
  sectionStart,
  sectionEnd,
}: {
  route: HighDensityRoute
  sectionStart: HighDensityRoute["route"][number]
  sectionEnd: HighDensityRoute["route"][number]
}): { score: number; reverse: boolean } | null => {
  const routeStart = route.route[0]
  const routeEnd = route.route.at(-1)
  if (!routeStart || !routeEnd) return null

  const directLayersMatch =
    routeStart.z === sectionStart.z && routeEnd.z === sectionEnd.z
  const reverseLayersMatch =
    routeStart.z === sectionEnd.z && routeEnd.z === sectionStart.z
  const directScore = directLayersMatch
    ? distance(routeStart, sectionStart) + distance(routeEnd, sectionEnd)
    : Number.POSITIVE_INFINITY
  const reverseScore = reverseLayersMatch
    ? distance(routeStart, sectionEnd) + distance(routeEnd, sectionStart)
    : Number.POSITIVE_INFINITY
  if (!Number.isFinite(directScore) && !Number.isFinite(reverseScore)) {
    return null
  }
  return directScore <= reverseScore
    ? { score: directScore, reverse: false }
    : { score: reverseScore, reverse: true }
}

const reverseRoutePoints = (
  route: HighDensityRoute["route"],
): HighDensityRoute["route"] => {
  const reversed = [...route].reverse().map((point) => {
    const { toNextSegmentType, ...pointWithoutSegmentType } = point
    return pointWithoutSegmentType
  }) as HighDensityRoute["route"]

  for (let pointIndex = 0; pointIndex < route.length - 1; pointIndex++) {
    const segmentType = route[pointIndex]?.toNextSegmentType
    if (!segmentType) continue
    reversed[route.length - pointIndex - 2] = {
      ...reversed[route.length - pointIndex - 2]!,
      toNextSegmentType: segmentType,
    }
  }
  return reversed
}

const pointsMatch = (
  left: HighDensityRoute["route"][number],
  right: HighDensityRoute["route"][number],
): boolean =>
  Math.abs(left.x - right.x) <= ENDPOINT_POSITION_EPSILON &&
  Math.abs(left.y - right.y) <= ENDPOINT_POSITION_EPSILON &&
  left.z === right.z

const connectRouteToSectionEndpoints = ({
  route,
  reverse,
  sectionStart,
  sectionEnd,
}: {
  route: HighDensityRoute
  reverse: boolean
  sectionStart: HighDensityRoute["route"][number]
  sectionEnd: HighDensityRoute["route"][number]
}): HighDensityRoute => {
  const routePoints = reverse
    ? reverseRoutePoints(route.route)
    : [...route.route]
  if (!routePoints[0] || !routePoints.at(-1)) {
    throw new Error(
      `Pipeline9 cannot materialize empty route "${route.connectionName}"`,
    )
  }
  if (!pointsMatch(routePoints[0], sectionStart)) {
    routePoints.unshift(sectionStart)
  }
  if (!pointsMatch(routePoints.at(-1)!, sectionEnd)) {
    routePoints.push(sectionEnd)
  }
  return { ...route, route: routePoints }
}

const getTraceIndexById = (traces: SimplifiedPcbTrace[]) =>
  new Map(traces.map((trace, traceIndex) => [trace.pcb_trace_id, traceIndex]))

const getSectionRangesByTraceIndex = ({
  traces,
  sections,
}: {
  traces: SimplifiedPcbTrace[]
  sections: ChangedPreloadedTraceSection[]
}) => {
  const traceIndexById = getTraceIndexById(traces)
  const rangesByTraceIndex = new Map<number, RoutePositionRange[]>()

  for (const section of sections) {
    const traceIndex = traceIndexById.get(section.traceId)
    if (traceIndex === undefined) {
      throw new Error(
        `Pipeline9 hypergraph changed missing preloaded trace "${section.traceId}"`,
      )
    }
    const ranges = rangesByTraceIndex.get(traceIndex) ?? []
    ranges.push({
      start: Math.min(section.startRoutePosition, section.endRoutePosition),
      end: Math.max(section.startRoutePosition, section.endRoutePosition),
    })
    rangesByTraceIndex.set(traceIndex, ranges)
  }

  for (const ranges of rangesByTraceIndex.values()) {
    ranges.sort(
      (left, right) => left.start - right.start || left.end - right.end,
    )
  }
  return rangesByTraceIndex
}

const interpolateRoutePoint = (
  route: HighDensityRoute["route"],
  fraction: number,
): HighDensityRoute["route"][number] => {
  const start = route[0]
  const end = route.at(-1)
  if (!start || !end) {
    throw new Error("Pipeline9 cannot split an empty preloaded route")
  }
  if (start.z !== end.z) {
    throw new Error(
      "Pipeline9 cannot partially split a preloaded layer transition",
    )
  }
  return {
    ...start,
    x: start.x + (end.x - start.x) * fraction,
    y: start.y + (end.y - start.y) * fraction,
  }
}

/**
 * Removes only the original copper intervals that the hypergraph changed.
 * Boundary-bearing wire sections are split so their untouched tails remain
 * fixed obstacles during high-density routing.
 */
export const removeChangedSectionsFromFixedHdRoutes = ({
  traces,
  fixedHdRoutes,
  sections,
}: {
  traces: SimplifiedPcbTrace[]
  fixedHdRoutes: PreloadedHighDensityRoute[]
  sections: ChangedPreloadedTraceSection[]
}): PreloadedHighDensityRoute[] => {
  const rangesByTraceIndex = getSectionRangesByTraceIndex({ traces, sections })

  return fixedHdRoutes.flatMap((fixedRoute) => {
    const sectionRanges = rangesByTraceIndex.get(fixedRoute.preloadedTraceIndex)
    if (!sectionRanges?.length) return [fixedRoute]

    const routeStart = fixedRoute.preloadedRoutePositionStart
    const routeEnd = fixedRoute.preloadedRoutePositionEnd
    if (routeStart === undefined || routeEnd === undefined) {
      throw new Error(
        `Pipeline9 fixed route "${fixedRoute.connectionName}" is missing route-position metadata`,
      )
    }

    if (Math.abs(routeEnd - routeStart) <= ROUTE_POSITION_EPSILON) {
      return sectionRanges.some(
        (range) =>
          range.start - ROUTE_POSITION_EPSILON <= routeStart &&
          routeStart <= range.end + ROUTE_POSITION_EPSILON,
      )
        ? []
        : [fixedRoute]
    }

    let remainingRanges: RoutePositionRange[] = [
      { start: routeStart, end: routeEnd },
    ]
    for (const removedRange of sectionRanges) {
      remainingRanges = remainingRanges.flatMap((remainingRange) => {
        if (
          removedRange.end <= remainingRange.start + ROUTE_POSITION_EPSILON ||
          removedRange.start >= remainingRange.end - ROUTE_POSITION_EPSILON
        ) {
          return [remainingRange]
        }

        const splitRanges: RoutePositionRange[] = []
        if (
          removedRange.start >
          remainingRange.start + ROUTE_POSITION_EPSILON
        ) {
          splitRanges.push({
            start: remainingRange.start,
            end: Math.min(removedRange.start, remainingRange.end),
          })
        }
        if (removedRange.end < remainingRange.end - ROUTE_POSITION_EPSILON) {
          splitRanges.push({
            start: Math.max(removedRange.end, remainingRange.start),
            end: remainingRange.end,
          })
        }
        return splitRanges
      })
    }

    return remainingRanges.map((remainingRange, fragmentIndex) => {
      const startFraction =
        (remainingRange.start - routeStart) / (routeEnd - routeStart)
      const endFraction =
        (remainingRange.end - routeStart) / (routeEnd - routeStart)
      return {
        ...fixedRoute,
        connectionName: `${fixedRoute.connectionName}_hypergraph_fixed_${fragmentIndex}`,
        preloadedRoutePositionStart: remainingRange.start,
        preloadedRoutePositionEnd: remainingRange.end,
        route: [
          interpolateRoutePoint(fixedRoute.route, startFraction),
          interpolateRoutePoint(fixedRoute.route, endFraction),
        ],
        vias: [],
      }
    })
  })
}

/**
 * Converts stitched hypergraph sections into the ordered fixed-route form used
 * to reconstruct their original PCB traces.
 */
export const getMaterializedPreloadedSectionHdRoutes = ({
  traces,
  sections,
  stitchedHdRoutes,
  layerCount,
}: {
  traces: SimplifiedPcbTrace[]
  sections: ChangedPreloadedTraceSection[]
  stitchedHdRoutes: HighDensityRoute[]
  layerCount: number
}): PreloadedHighDensityRoute[] => {
  const traceIndexById = getTraceIndexById(traces)

  return sections.map((section, sectionIndex) => {
    const traceIndex = traceIndexById.get(section.traceId)
    if (traceIndex === undefined) {
      throw new Error(
        `Pipeline9 cannot materialize missing preloaded trace "${section.traceId}"`,
      )
    }
    const [sectionStart, sectionEnd] = getSectionEndpoints(section, layerCount)
    const alignedRoutes = stitchedHdRoutes.flatMap((route) => {
      if (route.connectionName !== section.connectionName) return []
      const alignment = getEndpointAlignment({
        route,
        sectionStart,
        sectionEnd,
      })
      return alignment ? [{ route, ...alignment }] : []
    })
    alignedRoutes.sort((left, right) => left.score - right.score)
    const selectedRoute = alignedRoutes[0]
    const nextRoute = alignedRoutes[1]
    if (
      !selectedRoute ||
      (nextRoute &&
        Math.abs(nextRoute.score - selectedRoute.score) <=
          ENDPOINT_POSITION_EPSILON)
    ) {
      throw new Error(
        `Pipeline9 expected one nearest stitched route for changed preloaded section "${section.connectionName}", got ${alignedRoutes.length}`,
      )
    }
    const stitchedRoute = connectRouteToSectionEndpoints({
      route: selectedRoute.route,
      reverse: selectedRoute.reverse,
      sectionStart,
      sectionEnd,
    })

    return {
      ...stitchedRoute,
      preloadedTraceIndex: traceIndex,
      preloadedRouteIndex:
        Number.MAX_SAFE_INTEGER - sections.length + sectionIndex,
      preloadedRoutePositionStart: section.startRoutePosition,
      preloadedRoutePositionEnd: section.endRoutePosition,
      isThroughObstacle: false,
    }
  })
}
