import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { PortPoint } from "lib/types/high-density-types"
import type { CoordinateInterval, SharedEdge } from "./types"

const EDGE_TOLERANCE = 1e-3

const getAxisCoordinate = (
  sharedEdge: SharedEdge,
  point: { x: number; y: number },
) => (sharedEdge.orientation === "horizontal" ? point.x : point.y)

const getPerpendicularCoordinate = (
  sharedEdge: SharedEdge,
  point: { x: number; y: number },
) => (sharedEdge.orientation === "horizontal" ? point.y : point.x)

const isConnectedToEveryPort = ({
  connectionId,
  ports,
  connMap,
}: {
  connectionId: string
  ports: PortPoint[]
  connMap?: ConnectivityMap
}) =>
  ports.every((port) =>
    [port.connectionName, port.rootConnectionName].some(
      (portConnectionId) =>
        portConnectionId !== undefined &&
        (portConnectionId === connectionId ||
          (connMap?.areIdsConnected(portConnectionId, connectionId) ?? false)),
    ),
  )

const mergeIntervals = (
  intervals: CoordinateInterval[],
): CoordinateInterval[] => {
  const sortedIntervals = intervals
    .filter((interval) => interval.max >= interval.min)
    .sort((a, b) => a.min - b.min || a.max - b.max)
  const merged: CoordinateInterval[] = []

  for (const interval of sortedIntervals) {
    const previous = merged.at(-1)
    if (!previous || interval.min > previous.max + EDGE_TOLERANCE) {
      merged.push({ ...interval })
      continue
    }
    previous.max = Math.max(previous.max, interval.max)
  }

  return merged
}

/**
 * Projects fixed terminals onto one shared edge. Uniform redistribution may
 * use the remaining edge coordinates, but cannot move a trace centerline into
 * these clearance intervals.
 */
export const getReservedCoordinateIntervals = ({
  sharedEdge,
  z,
  familyPortPoints,
  allPortPoints,
  fixedPortPointIds,
  minTraceWidth,
  traceClearance,
  connMap,
}: {
  sharedEdge: SharedEdge
  z: number
  familyPortPoints: PortPoint[]
  allPortPoints: PortPoint[]
  fixedPortPointIds: ReadonlySet<string>
  minTraceWidth: number
  traceClearance: number
  connMap?: ConnectivityMap
}): CoordinateInterval[] => {
  const intervals: CoordinateInterval[] = []
  const familyPortPointIds = new Set(
    familyPortPoints.flatMap((portPoint) =>
      portPoint.portPointId ? [portPoint.portPointId] : [],
    ),
  )
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
  const portSpacing = minTraceWidth + traceClearance

  const seenPortPointIds = new Set<string>()
  for (const portPoint of allPortPoints) {
    if (
      (portPoint.z ?? 0) !== z ||
      !portPoint.portPointId ||
      !fixedPortPointIds.has(portPoint.portPointId) ||
      familyPortPointIds.has(portPoint.portPointId) ||
      seenPortPointIds.has(portPoint.portPointId) ||
      isConnectedToEveryPort({
        connectionId: portPoint.rootConnectionName ?? portPoint.connectionName,
        ports: familyPortPoints,
        connMap,
      })
    ) {
      continue
    }
    seenPortPointIds.add(portPoint.portPointId)

    const perpendicularCoordinate = getPerpendicularCoordinate(
      sharedEdge,
      portPoint,
    )
    const axisCoordinate = getAxisCoordinate(sharedEdge, portPoint)
    if (
      Math.abs(perpendicularCoordinate - edgePerpendicularCoordinate) >
        EDGE_TOLERANCE ||
      axisCoordinate < edgeAxisMin - EDGE_TOLERANCE ||
      axisCoordinate > edgeAxisMax + EDGE_TOLERANCE
    ) {
      continue
    }

    intervals.push({
      min: axisCoordinate - portSpacing,
      max: axisCoordinate + portSpacing,
    })
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
