import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { PortPoint } from "lib/types/high-density-types"
import { getKeepoutCoordinateInterval } from "./getKeepoutCoordinateInterval"
import type {
  BoundaryPortKeepout,
  CoordinateInterval,
  PortPointId,
  SharedEdge,
} from "./types"

const EDGE_TOLERANCE = 1e-3

const getAxisCoordinate = (
  sharedEdge: SharedEdge,
  point: { x: number; y: number },
) => (sharedEdge.orientation === "horizontal" ? point.x : point.y)

const getPerpendicularCoordinate = (
  sharedEdge: SharedEdge,
  point: { x: number; y: number },
) => (sharedEdge.orientation === "horizontal" ? point.y : point.x)

const getConnectionIds = (portPoint: PortPoint) =>
  [portPoint.connectionName, portPoint.rootConnectionName].filter(
    (connectionId): connectionId is string =>
      typeof connectionId === "string" && connectionId.length > 0,
  )

const getCanonicalConnectionIds = (
  connectionIds: string[],
  connMap?: ConnectivityMap,
) =>
  connectionIds.map(
    (connectionId) =>
      connMap?.getNetConnectedToId(connectionId) ?? connectionId,
  )

const areConnectionIdsConnected = ({
  leftConnectionIds,
  rightConnectionIds,
  connMap,
}: {
  leftConnectionIds: string[]
  rightConnectionIds: string[]
  connMap?: ConnectivityMap
}) => {
  const canonicalRightConnectionIds = new Set(
    getCanonicalConnectionIds(rightConnectionIds, connMap),
  )
  return getCanonicalConnectionIds(leftConnectionIds, connMap).some(
    (connectionId) => canonicalRightConnectionIds.has(connectionId),
  )
}

const mergeIntervals = (
  intervals: CoordinateInterval[],
): CoordinateInterval[] => {
  const sortedIntervals = intervals
    .filter((interval) => interval.max >= interval.min)
    .sort((left, right) => left.min - right.min || left.max - right.max)
  const mergedIntervals: CoordinateInterval[] = []

  for (const interval of sortedIntervals) {
    const previousInterval = mergedIntervals.at(-1)
    if (
      !previousInterval ||
      interval.min > previousInterval.max + EDGE_TOLERANCE
    ) {
      mergedIntervals.push({ ...interval })
      continue
    }
    previousInterval.max = Math.max(previousInterval.max, interval.max)
  }

  return mergedIntervals
}

/**
 * Returns the edge coordinates where one routed boundary point would violate
 * clearance to a fixed terminal or immutable copper on the same layer.
 */
export const getReservedCoordinateIntervals = ({
  sharedEdge,
  targetPortPoint,
  allPortPoints,
  fixedPortPointIds,
  copperKeepouts,
  minTraceWidth,
  traceClearance,
  connMap,
}: {
  sharedEdge: SharedEdge
  targetPortPoint: PortPoint
  allPortPoints: PortPoint[]
  fixedPortPointIds: ReadonlySet<PortPointId>
  copperKeepouts: BoundaryPortKeepout[]
  minTraceWidth: number
  traceClearance: number
  connMap?: ConnectivityMap
}): CoordinateInterval[] => {
  const edgeAxisMin = Math.min(
    getAxisCoordinate(sharedEdge, {
      x: sharedEdge.x1,
      y: sharedEdge.y1,
    }),
    getAxisCoordinate(sharedEdge, {
      x: sharedEdge.x2,
      y: sharedEdge.y2,
    }),
  )
  const edgeAxisMax = Math.max(
    getAxisCoordinate(sharedEdge, {
      x: sharedEdge.x1,
      y: sharedEdge.y1,
    }),
    getAxisCoordinate(sharedEdge, {
      x: sharedEdge.x2,
      y: sharedEdge.y2,
    }),
  )
  const edgePerpendicularCoordinate =
    sharedEdge.orientation === "horizontal" ? sharedEdge.y1 : sharedEdge.x1
  const targetConnectionIds = getConnectionIds(targetPortPoint)
  const targetZ = targetPortPoint.z ?? 0
  const intervals: CoordinateInterval[] = []
  const seenFixedPortPointIds = new Set<PortPointId>()

  for (const fixedPortPoint of allPortPoints) {
    if (!fixedPortPoint.portPointId) continue
    const fixedPortPointId = fixedPortPoint.portPointId as PortPointId
    if (
      fixedPortPointId === targetPortPoint.portPointId ||
      (fixedPortPoint.z ?? 0) !== targetZ ||
      !fixedPortPointIds.has(fixedPortPointId) ||
      seenFixedPortPointIds.has(fixedPortPointId) ||
      areConnectionIdsConnected({
        leftConnectionIds: targetConnectionIds,
        rightConnectionIds: getConnectionIds(fixedPortPoint),
        connMap,
      })
    ) {
      continue
    }
    seenFixedPortPointIds.add(fixedPortPointId)

    const perpendicularCoordinate = getPerpendicularCoordinate(
      sharedEdge,
      fixedPortPoint,
    )
    const axisCoordinate = getAxisCoordinate(sharedEdge, fixedPortPoint)
    if (
      Math.abs(perpendicularCoordinate - edgePerpendicularCoordinate) >
        EDGE_TOLERANCE ||
      axisCoordinate < edgeAxisMin - EDGE_TOLERANCE ||
      axisCoordinate > edgeAxisMax + EDGE_TOLERANCE
    ) {
      continue
    }

    const requiredCenterDistance = minTraceWidth + traceClearance
    intervals.push({
      min: axisCoordinate - requiredCenterDistance,
      max: axisCoordinate + requiredCenterDistance,
    })
  }

  for (const copperKeepout of copperKeepouts) {
    if (
      copperKeepout.z !== targetZ ||
      areConnectionIdsConnected({
        leftConnectionIds: targetConnectionIds,
        rightConnectionIds: copperKeepout.connectedTo,
        connMap,
      })
    ) {
      continue
    }
    const interval = getKeepoutCoordinateInterval({
      sharedEdge,
      keepout: copperKeepout,
      traceRadius: minTraceWidth / 2,
      clearance: traceClearance,
    })
    if (interval) intervals.push(interval)
  }

  return mergeIntervals(
    intervals
      .map((interval) => ({
        min: Math.max(edgeAxisMin, interval.min),
        max: Math.min(edgeAxisMax, interval.max),
      }))
      .filter((interval) => interval.max >= interval.min),
  )
}
