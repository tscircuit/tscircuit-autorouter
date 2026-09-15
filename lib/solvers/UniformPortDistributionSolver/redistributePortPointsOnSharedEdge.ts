import { CoordinateInterval, PortPointWithOwnerPair, SharedEdge } from "./types"

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

const getNearestAvailableCoordinate = ({
  idealCoordinate,
  originalCoordinate,
  edgeMin,
  edgeMax,
  reservedIntervals,
  previousCoordinate,
  minimumSpacing,
}: {
  idealCoordinate: number
  originalCoordinate: number
  edgeMin: number
  edgeMax: number
  reservedIntervals: CoordinateInterval[]
  previousCoordinate?: number
  minimumSpacing: number
}) => {
  const minimumCoordinate = Math.max(
    edgeMin,
    previousCoordinate === undefined
      ? edgeMin
      : previousCoordinate + minimumSpacing,
  )
  const freeIntervals: CoordinateInterval[] = []
  let cursor = minimumCoordinate

  for (const reservedInterval of reservedIntervals) {
    if (reservedInterval.max < cursor) continue
    if (reservedInterval.min > cursor) {
      freeIntervals.push({
        min: cursor,
        max: Math.min(edgeMax, reservedInterval.min - POSITION_EPSILON),
      })
    }
    cursor = Math.max(cursor, reservedInterval.max + POSITION_EPSILON)
    if (cursor > edgeMax) break
  }
  if (cursor <= edgeMax) freeIntervals.push({ min: cursor, max: edgeMax })

  const candidates = [idealCoordinate, originalCoordinate]
  for (const interval of freeIntervals) {
    candidates.push(
      Math.max(interval.min, Math.min(interval.max, idealCoordinate)),
      interval.min,
      interval.max,
    )
  }

  return candidates
    .filter(
      (coordinate) =>
        coordinate >= minimumCoordinate - POSITION_EPSILON &&
        coordinate <= edgeMax + POSITION_EPSILON &&
        isCoordinateAvailable(coordinate, reservedIntervals),
    )
    .sort(
      (a, b) =>
        Math.abs(a - idealCoordinate) - Math.abs(b - idealCoordinate) ||
        Math.abs(a - originalCoordinate) - Math.abs(b - originalCoordinate) ||
        a - b,
    )[0]
}

/**
 * Repositions each owner-pair family uniformly along its shared edge while
 * preserving layer grouping and a stable ordering along the edge axis.
 */
export const redistributePortPointsOnSharedEdge = ({
  sharedEdge,
  portPoints,
  reservedIntervalsByZ = new Map(),
  minimumSpacing = 0,
}: {
  sharedEdge: SharedEdge
  portPoints: PortPointWithOwnerPair[]
  reservedIntervalsByZ?: ReadonlyMap<number, CoordinateInterval[]>
  minimumSpacing?: number
}): PortPointWithOwnerPair[] => {
  if (portPoints.length === 0) return []

  const portsByZ = new Map<number, PortPointWithOwnerPair[]>()
  for (const portPoint of portPoints) {
    const z = portPoint.z ?? 0
    const existing = portsByZ.get(z) ?? []
    existing.push(portPoint)
    portsByZ.set(z, existing)
  }

  const redistributed: PortPointWithOwnerPair[] = []
  const zLayers = Array.from(portsByZ.keys()).sort((a, b) => a - b)

  for (const z of zLayers) {
    const portsOnZ = portsByZ.get(z)!
    const count = portsOnZ.length

    portsOnZ.sort((a, b) =>
      sharedEdge.orientation === "horizontal" ? a.x - b.x : a.y - b.y,
    )

    const edgeMin =
      sharedEdge.orientation === "horizontal"
        ? Math.min(sharedEdge.x1, sharedEdge.x2)
        : Math.min(sharedEdge.y1, sharedEdge.y2)
    const edgeMax =
      sharedEdge.orientation === "horizontal"
        ? Math.max(sharedEdge.x1, sharedEdge.x2)
        : Math.max(sharedEdge.y1, sharedEdge.y2)
    const reservedIntervals = reservedIntervalsByZ.get(z) ?? []
    const redistributedPortsOnZ: PortPointWithOwnerPair[] = []
    const idealCoordinates = portsOnZ.map(
      (_, index) =>
        edgeMin + sharedEdge.length * ((2 * index + 1) / (2 * count)),
    )
    const originalCoordinates = portsOnZ.map((portPoint) =>
      sharedEdge.orientation === "horizontal" ? portPoint.x : portPoint.y,
    )

    const useOriginalCoordinates =
      !idealCoordinates.every((coordinate) =>
        isCoordinateAvailable(coordinate, reservedIntervals),
      ) &&
      originalCoordinates.every((coordinate) =>
        isCoordinateAvailable(coordinate, reservedIntervals),
      )

    for (let i = 0; i < count; i++) {
      const fraction = (2 * i + 1) / (2 * count)
      const idealCoordinate = edgeMin + sharedEdge.length * fraction
      const originalCoordinate =
        sharedEdge.orientation === "horizontal"
          ? portsOnZ[i]!.x
          : portsOnZ[i]!.y
      const previousPort = redistributedPortsOnZ.at(-1)
      const previousCoordinate = previousPort
        ? sharedEdge.orientation === "horizontal"
          ? previousPort.x
          : previousPort.y
        : undefined
      const coordinate =
        reservedIntervals.length === 0
          ? idealCoordinate
          : useOriginalCoordinates
            ? originalCoordinate
            : getNearestAvailableCoordinate({
                idealCoordinate,
                originalCoordinate,
                edgeMin,
                edgeMax,
                reservedIntervals,
                previousCoordinate,
                minimumSpacing,
              })

      if (coordinate === undefined) {
        redistributedPortsOnZ.length = 0
        redistributedPortsOnZ.push(
          ...portsOnZ.map((portPoint, index) => ({
            ...portPoint,
            x:
              sharedEdge.orientation === "horizontal"
                ? idealCoordinates[index]!
                : sharedEdge.x1,
            y:
              sharedEdge.orientation === "horizontal"
                ? sharedEdge.y1
                : idealCoordinates[index]!,
          })),
        )
        break
      }

      redistributedPortsOnZ.push({
        ...portsOnZ[i]!,
        x: sharedEdge.orientation === "horizontal" ? coordinate : sharedEdge.x1,
        y: sharedEdge.orientation === "horizontal" ? sharedEdge.y1 : coordinate,
      })
    }

    redistributed.push(...redistributedPortsOnZ)
  }

  return redistributed
}
