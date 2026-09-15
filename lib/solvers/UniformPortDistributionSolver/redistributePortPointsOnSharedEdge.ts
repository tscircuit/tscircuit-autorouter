import type {
  CoordinateInterval,
  PortPointId,
  PortPointWithOwnerPair,
  SharedEdge,
} from "./types"

const POSITION_EPSILON = 1e-6

const isCoordinateAvailable = (
  coordinate: number,
  reservedIntervals: CoordinateInterval[],
) =>
  reservedIntervals.every(
    (interval) =>
      coordinate < interval.min - POSITION_EPSILON ||
      coordinate > interval.max + POSITION_EPSILON,
  )

const getFreeIntervals = ({
  edgeMin,
  edgeMax,
  reservedIntervals,
}: {
  edgeMin: number
  edgeMax: number
  reservedIntervals: CoordinateInterval[]
}): CoordinateInterval[] => {
  const freeIntervals: CoordinateInterval[] = []
  let cursor = edgeMin
  for (const reservedInterval of reservedIntervals) {
    if (reservedInterval.max < cursor) continue
    if (reservedInterval.min > cursor) {
      freeIntervals.push({
        min: cursor,
        max: Math.min(edgeMax, reservedInterval.min - 2 * POSITION_EPSILON),
      })
    }
    cursor = Math.max(cursor, reservedInterval.max + 2 * POSITION_EPSILON)
    if (cursor > edgeMax) break
  }
  if (cursor <= edgeMax) freeIntervals.push({ min: cursor, max: edgeMax })
  return freeIntervals.filter((interval) => interval.max >= interval.min)
}

const getFirstAvailableCoordinate = ({
  minimumCoordinate,
  edgeMax,
  reservedIntervals,
}: {
  minimumCoordinate: number
  edgeMax: number
  reservedIntervals: CoordinateInterval[]
}): number | undefined => {
  let coordinate = minimumCoordinate
  for (const interval of reservedIntervals) {
    if (coordinate < interval.min - POSITION_EPSILON) return coordinate
    if (coordinate <= interval.max + POSITION_EPSILON) {
      coordinate = interval.max + 2 * POSITION_EPSILON
    }
    if (coordinate > edgeMax + POSITION_EPSILON) return undefined
  }
  return coordinate <= edgeMax + POSITION_EPSILON ? coordinate : undefined
}

const getCandidateCoordinates = ({
  idealCoordinate,
  originalCoordinate,
  minimumCoordinate,
  edgeMax,
  reservedIntervals,
}: {
  idealCoordinate: number
  originalCoordinate: number
  minimumCoordinate: number
  edgeMax: number
  reservedIntervals: CoordinateInterval[]
}) => {
  const freeIntervals = getFreeIntervals({
    edgeMin: minimumCoordinate,
    edgeMax,
    reservedIntervals,
  })
  const candidates: number[] = []
  for (const interval of freeIntervals) {
    candidates.push(
      Math.max(interval.min, Math.min(interval.max, idealCoordinate)),
      Math.max(interval.min, Math.min(interval.max, originalCoordinate)),
      interval.min,
      interval.max,
    )
  }
  const uniqueCandidates = [...new Set(candidates)].filter(
    (coordinate) =>
      coordinate >= minimumCoordinate - POSITION_EPSILON &&
      coordinate <= edgeMax + POSITION_EPSILON &&
      isCoordinateAvailable(coordinate, reservedIntervals),
  )
  const primaryCoordinate =
    idealCoordinate >= minimumCoordinate - POSITION_EPSILON &&
    idealCoordinate <= edgeMax + POSITION_EPSILON &&
    isCoordinateAvailable(idealCoordinate, reservedIntervals)
      ? idealCoordinate
      : originalCoordinate
  return uniqueCandidates.sort(
    (left, right) =>
      Math.abs(left - primaryCoordinate) -
        Math.abs(right - primaryCoordinate) ||
      Math.abs(left - idealCoordinate) - Math.abs(right - idealCoordinate) ||
      Math.abs(left - originalCoordinate) -
        Math.abs(right - originalCoordinate) ||
      left - right,
  )
}

const canPlaceRemainingPorts = ({
  startingPortIndex,
  previousCoordinate,
  portsOnZ,
  reservedIntervalsByPortPointId,
  edgeMax,
  minimumSpacing,
}: {
  startingPortIndex: number
  previousCoordinate: number
  portsOnZ: PortPointWithOwnerPair[]
  reservedIntervalsByPortPointId: ReadonlyMap<PortPointId, CoordinateInterval[]>
  edgeMax: number
  minimumSpacing: number
}) => {
  let lastCoordinate = previousCoordinate
  for (
    let portIndex = startingPortIndex;
    portIndex < portsOnZ.length;
    portIndex++
  ) {
    const portPointId = portsOnZ[portIndex]!.portPointId as
      | PortPointId
      | undefined
    const nextCoordinate = getFirstAvailableCoordinate({
      minimumCoordinate: lastCoordinate + minimumSpacing,
      edgeMax,
      reservedIntervals: portPointId
        ? (reservedIntervalsByPortPointId.get(portPointId) ?? [])
        : [],
    })
    if (nextCoordinate === undefined) return false
    lastCoordinate = nextCoordinate
  }
  return true
}

/**
 * Repositions each owner-pair family along its shared edge while preserving
 * layer grouping, stable order, and per-net clearance keepouts.
 * Throws when the selected edge cannot hold a legal ordered placement.
 */
export const redistributePortPointsOnSharedEdge = ({
  sharedEdge,
  portPoints,
  reservedIntervalsByPortPointId = new Map(),
  minimumSpacing = 0,
}: {
  sharedEdge: SharedEdge
  portPoints: PortPointWithOwnerPair[]
  reservedIntervalsByPortPointId?: ReadonlyMap<
    PortPointId,
    CoordinateInterval[]
  >
  minimumSpacing?: number
}): PortPointWithOwnerPair[] => {
  if (portPoints.length === 0) return []

  const portsByZ = new Map<number, PortPointWithOwnerPair[]>()
  for (const portPoint of portPoints) {
    const z = portPoint.z ?? 0
    const existingPorts = portsByZ.get(z) ?? []
    existingPorts.push(portPoint)
    portsByZ.set(z, existingPorts)
  }

  const redistributedPortPoints: PortPointWithOwnerPair[] = []
  const zLayers = Array.from(portsByZ.keys()).sort(
    (left, right) => left - right,
  )

  for (const z of zLayers) {
    const portsOnZ = portsByZ.get(z)!
    portsOnZ.sort((left, right) => {
      const axisDifference =
        sharedEdge.orientation === "horizontal"
          ? left.x - right.x
          : left.y - right.y
      return (
        axisDifference ||
        (left.portPointId ?? "").localeCompare(right.portPointId ?? "")
      )
    })

    const edgeMin =
      sharedEdge.orientation === "horizontal"
        ? Math.min(sharedEdge.x1, sharedEdge.x2)
        : Math.min(sharedEdge.y1, sharedEdge.y2)
    const edgeMax =
      sharedEdge.orientation === "horizontal"
        ? Math.max(sharedEdge.x1, sharedEdge.x2)
        : Math.max(sharedEdge.y1, sharedEdge.y2)
    const idealCoordinates = portsOnZ.map(
      (_, portIndex) =>
        edgeMin +
        sharedEdge.length * ((2 * portIndex + 1) / (2 * portsOnZ.length)),
    )
    const originalCoordinates = portsOnZ.map((portPoint) =>
      sharedEdge.orientation === "horizontal" ? portPoint.x : portPoint.y,
    )
    const selectedCoordinates: number[] = []

    for (let portIndex = 0; portIndex < portsOnZ.length; portIndex++) {
      const portPoint = portsOnZ[portIndex]!
      const portPointId = portPoint.portPointId as PortPointId | undefined
      const reservedIntervals = portPointId
        ? (reservedIntervalsByPortPointId.get(portPointId) ?? [])
        : []
      const minimumCoordinate =
        portIndex === 0
          ? edgeMin
          : selectedCoordinates[portIndex - 1]! + minimumSpacing
      const candidates = getCandidateCoordinates({
        idealCoordinate: idealCoordinates[portIndex]!,
        originalCoordinate: originalCoordinates[portIndex]!,
        minimumCoordinate,
        edgeMax,
        reservedIntervals,
      })
      const selectedCoordinate = candidates.find((candidate) =>
        canPlaceRemainingPorts({
          startingPortIndex: portIndex + 1,
          previousCoordinate: candidate,
          portsOnZ,
          reservedIntervalsByPortPointId,
          edgeMax,
          minimumSpacing,
        }),
      )
      if (selectedCoordinate === undefined) {
        const portIds = portsOnZ
          .map((candidatePort) => candidatePort.portPointId ?? "<missing-id>")
          .join(", ")
        throw new Error(
          `Uniform port distribution cannot place [${portIds}] on shared edge "${sharedEdge.ownerPairKey}" at z=${z} with ${minimumSpacing}mm spacing`,
        )
      }
      selectedCoordinates.push(selectedCoordinate)
    }

    redistributedPortPoints.push(
      ...portsOnZ.map((portPoint, portIndex) => ({
        ...portPoint,
        x:
          sharedEdge.orientation === "horizontal"
            ? selectedCoordinates[portIndex]!
            : sharedEdge.x1,
        y:
          sharedEdge.orientation === "horizontal"
            ? sharedEdge.y1
            : selectedCoordinates[portIndex]!,
      })),
    )
  }

  return redistributedPortPoints
}
