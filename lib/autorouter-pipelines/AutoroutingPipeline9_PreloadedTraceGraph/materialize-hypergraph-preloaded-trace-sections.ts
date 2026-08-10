import type { ChangedPreloadedTraceSection } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { PreloadedHighDensityRoute } from "./convert-preloaded-traces-to-hd-routes"

type RoutePositionRange = {
  start: number
  end: number
}

const ROUTE_POSITION_EPSILON = 1e-9

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
}: {
  traces: SimplifiedPcbTrace[]
  sections: ChangedPreloadedTraceSection[]
  stitchedHdRoutes: HighDensityRoute[]
}): PreloadedHighDensityRoute[] => {
  const traceIndexById = getTraceIndexById(traces)

  return sections.map((section, sectionIndex) => {
    const traceIndex = traceIndexById.get(section.traceId)
    if (traceIndex === undefined) {
      throw new Error(
        `Pipeline9 cannot materialize missing preloaded trace "${section.traceId}"`,
      )
    }
    const stitchedRoutes = stitchedHdRoutes.filter(
      (route) => route.connectionName === section.connectionName,
    )
    if (stitchedRoutes.length !== 1) {
      throw new Error(
        `Pipeline9 expected one stitched route for changed preloaded section "${section.connectionName}", got ${stitchedRoutes.length}`,
      )
    }
    const stitchedRoute = stitchedRoutes[0]!

    return {
      ...stitchedRoute,
      preloadedTraceIndex: traceIndex,
      preloadedRouteIndex:
        Number.MAX_SAFE_INTEGER - sections.length + sectionIndex,
      preloadedRoutePositionStart: section.startRoutePosition,
      preloadedRoutePositionEnd: section.endRoutePosition,
    }
  })
}
