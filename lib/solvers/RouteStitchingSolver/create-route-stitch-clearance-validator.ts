import { pointToSegmentDistance, type Point3 } from "@tscircuit/math-utils"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

export type StitchSegmentRequest = {
  connectionName: string
  start: Point3
  end: Point3
  traceThickness: number
}

export type IsStitchSegmentClear = (
  request: StitchSegmentRequest,
) => boolean

type RouteSegment = {
  connectionName: string
  start: HighDensityIntraNodeRoute["route"][number]
  end: HighDensityIntraNodeRoute["route"][number]
  traceThickness: number
}

type RouteVia = {
  connectionName: string
  x: number
  y: number
  diameter: number
}

const CLEARANCE_TOLERANCE = 1e-6

const preservesEndpointClearance = ({
  startGap,
  endGap,
  segmentGap,
  requiredGap,
}: {
  startGap: number
  endGap: number
  segmentGap: number
  requiredGap: number
}): boolean => {
  const escapesFromStart =
    startGap < requiredGap &&
    endGap >= requiredGap - CLEARANCE_TOLERANCE &&
    segmentGap >= startGap - CLEARANCE_TOLERANCE
  const escapesFromEnd =
    endGap < requiredGap &&
    startGap >= requiredGap - CLEARANCE_TOLERANCE &&
    segmentGap >= endGap - CLEARANCE_TOLERANCE

  return escapesFromStart || escapesFromEnd
}

export const createRouteStitchClearanceValidator = (params: {
  hdRoutes: HighDensityIntraNodeRoute[]
  minClearance?: number
}): IsStitchSegmentClear => {
  const minClearance = params.minClearance ?? 0.1
  const rootsByConnection = new Map<string, Set<string>>()
  const segments: RouteSegment[] = []
  const vias: RouteVia[] = []

  for (const route of params.hdRoutes) {
    const roots = rootsByConnection.get(route.connectionName) ?? new Set()
    roots.add(route.rootConnectionName ?? route.connectionName)
    rootsByConnection.set(route.connectionName, roots)

    for (let index = 0; index < route.route.length - 1; index += 1) {
      const start = route.route[index]!
      const end = route.route[index + 1]!
      if (start.z !== end.z) continue
      if (start.insideJumperPad && end.insideJumperPad) continue
      segments.push({
        connectionName: route.connectionName,
        start,
        end,
        traceThickness: route.traceThickness,
      })
    }

    for (const via of route.vias) {
      vias.push({
        connectionName: route.connectionName,
        x: via.x,
        y: via.y,
        diameter: route.viaDiameter,
      })
    }
  }

  const areSameNet = (
    firstConnectionName: string,
    secondConnectionName: string,
  ): boolean => {
    if (firstConnectionName === secondConnectionName) return true
    const firstRoots = rootsByConnection.get(firstConnectionName)
    const secondRoots = rootsByConnection.get(secondConnectionName)
    if (!firstRoots || !secondRoots) return false
    return [...firstRoots].some((root) => secondRoots.has(root))
  }

  return ({ connectionName, start, end, traceThickness }) => {
    const traceRadius = traceThickness / 2

    for (const segment of segments) {
      if (segment.start.z !== start.z) continue
      if (areSameNet(connectionName, segment.connectionName)) continue

      const requiredGap =
        minClearance + traceRadius + segment.traceThickness / 2
      const segmentGap = minimumDistanceBetweenSegments(
        start,
        end,
        segment.start,
        segment.end,
      )
      if (
        segmentGap < requiredGap &&
        !preservesEndpointClearance({
          startGap: pointToSegmentDistance(
            start,
            segment.start,
            segment.end,
          ),
          endGap: pointToSegmentDistance(end, segment.start, segment.end),
          segmentGap,
          requiredGap,
        })
      ) {
        return false
      }
    }

    for (const via of vias) {
      if (areSameNet(connectionName, via.connectionName)) continue

      const requiredGap = minClearance + traceRadius + via.diameter / 2
      const segmentGap = pointToSegmentDistance(via, start, end)
      if (
        segmentGap < requiredGap &&
        !preservesEndpointClearance({
          startGap: Math.hypot(start.x - via.x, start.y - via.y),
          endGap: Math.hypot(end.x - via.x, end.y - via.y),
          segmentGap,
          requiredGap,
        })
      ) {
        return false
      }
    }

    return true
  }
}
