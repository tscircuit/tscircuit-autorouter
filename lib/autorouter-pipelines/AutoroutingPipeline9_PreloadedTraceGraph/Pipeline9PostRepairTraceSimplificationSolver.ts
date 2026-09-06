import { BaseSolver } from "lib/solvers/BaseSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

type RoutePoint = HighDensityRoute["route"][number]

const POINT_EPSILON = 1e-9

const pointsAreColocated = (
  left: { x: number; y: number },
  right: { x: number; y: number },
): boolean => {
  const deltaX = Math.abs(left.x - right.x)
  const deltaY = Math.abs(left.y - right.y)
  return deltaX <= POINT_EPSILON && deltaY <= POINT_EPSILON
}

const pointIsJumperEndpoint = (
  point: RoutePoint,
  route: HighDensityRoute,
): boolean =>
  (route.jumpers ?? []).some(
    (jumper) =>
      pointsAreColocated(point, jumper.start) ||
      pointsAreColocated(point, jumper.end),
  )

const pointBlocksCopperSubsetCleanup = (
  point: RoutePoint,
  route: HighDensityRoute,
): boolean =>
  point.pcb_port_id !== undefined ||
  point.insideJumperPad === true ||
  point.toNextSegmentType !== undefined ||
  point.toNextSegmentCircuitJsonMetadata !== undefined ||
  pointIsJumperEndpoint(point, route)

const eraseClosedCopperDetours = (route: HighDensityRoute): RoutePoint[] => {
  const cleanedPoints: RoutePoint[] = []
  const pointIndexByKey = new Map<string, number>()

  for (let pointIndex = 0; pointIndex < route.route.length; pointIndex++) {
    const point = route.route[pointIndex]!
    const previousPoint = cleanedPoints.at(-1)
    if (
      previousPoint?.toNextSegmentType !== undefined ||
      previousPoint?.toNextSegmentCircuitJsonMetadata !== undefined
    ) {
      pointIndexByKey.clear()
    }

    const pointKey = `${point.x}:${point.y}:${point.z}`
    const repeatedPointIndex = pointIndexByKey.get(pointKey)
    const repeatedPoint =
      repeatedPointIndex === undefined
        ? undefined
        : cleanedPoints[repeatedPointIndex]
    const canEraseDetour =
      repeatedPointIndex !== undefined &&
      repeatedPoint !== undefined &&
      pointIndex < route.route.length - 1 &&
      !pointBlocksCopperSubsetCleanup(point, route) &&
      repeatedPoint.traceThickness === point.traceThickness

    if (canEraseDetour) {
      for (
        let removedIndex = cleanedPoints.length - 1;
        removedIndex > repeatedPointIndex;
        removedIndex--
      ) {
        const removedPoint = cleanedPoints[removedIndex]!
        pointIndexByKey.delete(
          `${removedPoint.x}:${removedPoint.y}:${removedPoint.z}`,
        )
      }
      cleanedPoints.length = repeatedPointIndex + 1
      continue
    }

    cleanedPoints.push({ ...point })
    if (pointBlocksCopperSubsetCleanup(point, route)) {
      pointIndexByKey.clear()
    }
    pointIndexByKey.set(pointKey, cleanedPoints.length - 1)
  }

  return cleanedPoints
}

const pointIsBetweenCollinearNeighbors = (
  previousPoint: RoutePoint,
  point: RoutePoint,
  nextPoint: RoutePoint,
): boolean => {
  if (previousPoint.z !== point.z || point.z !== nextPoint.z) return false
  const firstDx = point.x - previousPoint.x
  const firstDy = point.y - previousPoint.y
  const secondDx = nextPoint.x - point.x
  const secondDy = nextPoint.y - point.y
  const crossProduct = firstDx * secondDy - firstDy * secondDx
  if (crossProduct !== 0) return false
  return firstDx * secondDx + firstDy * secondDy >= 0
}

const removeCollinearMiddlePoints = (
  route: HighDensityRoute,
  points: RoutePoint[],
): RoutePoint[] => {
  const cleanedPoints: RoutePoint[] = []
  for (const point of points) {
    cleanedPoints.push(point)
    while (cleanedPoints.length >= 3) {
      const previousPoint = cleanedPoints.at(-3)!
      const middlePoint = cleanedPoints.at(-2)!
      const nextPoint = cleanedPoints.at(-1)!
      const segmentWidth = previousPoint.traceThickness ?? route.traceThickness
      const widthsMatch =
        (middlePoint.traceThickness ?? route.traceThickness) === segmentWidth &&
        (nextPoint.traceThickness ?? route.traceThickness) === segmentWidth
      if (
        !widthsMatch ||
        pointBlocksCopperSubsetCleanup(middlePoint, route) ||
        previousPoint.toNextSegmentType !== undefined ||
        !pointIsBetweenCollinearNeighbors(previousPoint, middlePoint, nextPoint)
      ) {
        break
      }
      cleanedPoints.splice(cleanedPoints.length - 2, 1)
    }
  }
  return cleanedPoints
}

const getRouteVias = (
  route: HighDensityRoute,
  points: RoutePoint[],
): Array<{ x: number; y: number }> => {
  const vias: Array<{ x: number; y: number }> = []
  for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex++) {
    const start = points[pointIndex]!
    const end = points[pointIndex + 1]!
    if (start.z !== end.z && start.toNextSegmentType !== "through_obstacle") {
      const existingVia = route.vias.find(
        (via) => pointsAreColocated(via, start) || pointsAreColocated(via, end),
      )
      if (!existingVia) {
        throw new Error(
          `Pipeline9 post-repair route "${route.connectionName}" changes layers without an explicit via`,
        )
      }
      vias.push({ ...existingVia })
    }
  }
  return vias
}

const simplifyPipeline9PostRepairRoute = (
  route: HighDensityRoute,
): HighDensityRoute => {
  const detourFreePoints = eraseClosedCopperDetours(route)
  const routePoints = removeCollinearMiddlePoints(route, detourFreePoints)
  return {
    ...route,
    route: routePoints,
    vias: getRouteVias(route, routePoints),
  }
}

/**
 * Removes only redundant copper after Pipeline9 repair. Every retained wire is
 * a subset of the input geometry, so cleanup cannot introduce a collision.
 */
export class Pipeline9PostRepairTraceSimplificationSolver extends BaseSolver {
  readonly inputHdRoutes: readonly HighDensityRoute[]
  simplifiedHdRoutes: HighDensityRoute[]

  constructor({ hdRoutes }: { hdRoutes: readonly HighDensityRoute[] }) {
    super()
    this.inputHdRoutes = hdRoutes
    this.simplifiedHdRoutes = [...hdRoutes]
    this.MAX_ITERATIONS = 1
  }

  override getConstructorParams(): [{ hdRoutes: readonly HighDensityRoute[] }] {
    return [{ hdRoutes: this.inputHdRoutes }]
  }

  override _step(): void {
    this.simplifiedHdRoutes = this.inputHdRoutes.map(
      simplifyPipeline9PostRepairRoute,
    )
    this.stats = {
      inputPointCount: this.inputHdRoutes.reduce(
        (sum, route): number => sum + route.route.length,
        0,
      ),
      outputPointCount: this.simplifiedHdRoutes.reduce(
        (sum, route): number => sum + route.route.length,
        0,
      ),
      inputViaCount: this.inputHdRoutes.reduce(
        (sum, route): number => sum + route.vias.length,
        0,
      ),
      outputViaCount: this.simplifiedHdRoutes.reduce(
        (sum, route): number => sum + route.vias.length,
        0,
      ),
    }
    this.progress = 1
    this.solved = true
  }
}
