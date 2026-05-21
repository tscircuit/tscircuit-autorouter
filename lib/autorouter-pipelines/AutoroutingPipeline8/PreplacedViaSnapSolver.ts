import {
  distance,
  distSq,
  segmentToBoxMinDistance,
  segmentToSegmentMinDistance,
  type Point,
  type Point3,
} from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

type PreplacedVia = Point & {
  viaId: string
  diameter?: number
  connectedTo: string[]
}

type PreplacedViaSnapSolverParams = {
  hdRoutes: HighDensityRoute[]
  obstacles: Obstacle[]
  defaultViaDiameter: number
}

type RouteSegment = {
  start: Point3
  end: Point3
  routeNetKey: string
  traceThickness: number
}

const GEOMETRIC_TOLERANCE = 1e-6

const pointMatches = (a: Point, b: Point) =>
  distance(a, b) <= GEOMETRIC_TOLERANCE

const getRouteNetKey = (route: HighDensityRoute) =>
  route.rootConnectionName ?? route.connectionName

const getRouteSegments = (route: HighDensityRoute): RouteSegment[] => {
  const routeNetKey = getRouteNetKey(route)
  const segments: RouteSegment[] = []
  for (let i = 1; i < route.route.length; i++) {
    const start = route.route[i - 1]!
    const end = route.route[i]!
    if (start.z !== end.z) continue
    if (pointMatches(start, end)) continue
    segments.push({
      start,
      end,
      routeNetKey,
      traceThickness: route.traceThickness,
    })
  }
  return segments
}

const isPreplacedViaObstacle = (obstacle: Obstacle) =>
  obstacle.netIsAssignable === true &&
  obstacle.layers.includes("top") &&
  obstacle.layers.includes("bottom") &&
  obstacle.connectedTo.some((connectedId) => connectedId.startsWith("pcb_via"))

const getPreplacedViasFromObstacles = (
  obstacles: Obstacle[],
  defaultViaDiameter: number,
): PreplacedVia[] => {
  return obstacles.filter(isPreplacedViaObstacle).map((obstacle, index) => ({
    viaId:
      obstacle.connectedTo.find((connectedId) =>
        connectedId.startsWith("pcb_via"),
      ) ??
      obstacle.obstacleId ??
      `preplaced_via_${index}`,
    x: obstacle.center.x,
    y: obstacle.center.y,
    diameter: Math.min(obstacle.width, obstacle.height, defaultViaDiameter),
    connectedTo: [...obstacle.connectedTo],
  }))
}

export class PreplacedViaSnapSolver extends BaseSolver {
  snappedHdRoutes: HighDensityRoute[] = []
  preplacedVias: PreplacedVia[]
  private preplacedViaObstacles: Set<Obstacle>
  private inputRouteSegments: RouteSegment[]
  snappedViaCount = 0

  constructor(public readonly params: PreplacedViaSnapSolverParams) {
    super()
    this.MAX_ITERATIONS = 1
    this.preplacedVias = getPreplacedViasFromObstacles(
      params.obstacles,
      params.defaultViaDiameter,
    )
    this.preplacedViaObstacles = new Set(
      params.obstacles.filter(isPreplacedViaObstacle),
    )
    this.inputRouteSegments = params.hdRoutes.flatMap(getRouteSegments)
  }

  override getSolverName() {
    return "PreplacedViaSnapSolver"
  }

  override _step() {
    if (this.preplacedVias.length === 0) {
      this.snappedHdRoutes = structuredClone(this.params.hdRoutes)
      this.solved = true
      return
    }

    const assignedNetByViaId = new Map<string, string>()
    this.snappedHdRoutes = this.params.hdRoutes.map((route) =>
      this.snapRoute(route, assignedNetByViaId),
    )
    this.stats = {
      preplacedViaCount: this.preplacedVias.length,
      snappedViaCount: this.snappedViaCount,
    }
    this.solved = true
  }

  private scoreCandidateVia({
    via,
    previousPoint,
    currentPoint,
    nextPoint,
    routeNetKey,
    traceThickness,
  }: {
    via: PreplacedVia
    previousPoint: HighDensityRoute["route"][number]
    currentPoint: HighDensityRoute["route"][number]
    nextPoint?: HighDensityRoute["route"][number]
    routeNetKey: string
    traceThickness: number
  }) {
    let score = distSq(via, currentPoint) + distSq(via, previousPoint)

    const candidateSegments: RouteSegment[] = [
      {
        start: previousPoint,
        end: { x: via.x, y: via.y, z: previousPoint.z },
        routeNetKey,
        traceThickness,
      },
      {
        start: { x: via.x, y: via.y, z: currentPoint.z },
        end: nextPoint?.z === currentPoint.z ? nextPoint : currentPoint,
        routeNetKey,
        traceThickness,
      },
    ].filter((segment) => !pointMatches(segment.start, segment.end))

    for (const candidateSegment of candidateSegments) {
      for (const inputSegment of this.inputRouteSegments) {
        if (inputSegment.routeNetKey === routeNetKey) continue
        if (inputSegment.start.z !== candidateSegment.start.z) continue

        const minDistance = segmentToSegmentMinDistance(
          candidateSegment.start,
          candidateSegment.end,
          inputSegment.start,
          inputSegment.end,
        )
        const minAllowedDistance =
          candidateSegment.traceThickness / 2 +
          inputSegment.traceThickness / 2 +
          0.05

        if (minDistance < minAllowedDistance) {
          score +=
            100_000 +
            (minAllowedDistance - minDistance) * 10_000 +
            (minDistance === 0 ? 1_000_000 : 0)
        }
      }

      for (const obstacle of this.params.obstacles) {
        if (this.preplacedViaObstacles.has(obstacle)) {
          continue
        }
        if (
          !obstacle.layers.includes(
            candidateSegment.start.z === 0 ? "top" : "bottom",
          )
        ) {
          continue
        }

        const expandedObstacle = {
          center: obstacle.center,
          width: obstacle.width + traceThickness,
          height: obstacle.height + traceThickness,
        }

        if (
          segmentToBoxMinDistance(
            candidateSegment.start,
            candidateSegment.end,
            expandedObstacle,
          ) <= 0
        ) {
          score += 500_000
        }
      }
    }

    return score
  }

  private findBestAvailableVia(
    point: Point,
    routeNetKey: string,
    assignedNetByViaId: Map<string, string>,
    previousPoint: HighDensityRoute["route"][number],
    currentPoint: HighDensityRoute["route"][number],
    nextPoint: HighDensityRoute["route"][number] | undefined,
    traceThickness: number,
  ) {
    const sorted = this.preplacedVias
      .filter((via) => {
        const assignedNet = assignedNetByViaId.get(via.viaId)
        return !assignedNet || assignedNet === routeNetKey
      })
      .map((via) => ({
        via,
        distanceSquared: distSq(via, point),
        score: this.scoreCandidateVia({
          via,
          previousPoint,
          currentPoint,
          nextPoint,
          routeNetKey,
          traceThickness,
        }),
      }))
      .sort(
        (a, b) => a.score - b.score || a.distanceSquared - b.distanceSquared,
      )

    return sorted[0]?.via
  }

  private snapRoute(
    route: HighDensityRoute,
    assignedNetByViaId: Map<string, string>,
  ): HighDensityRoute {
    if (route.route.length === 0) {
      return structuredClone(route)
    }

    const routeNetKey = getRouteNetKey(route)
    const snappedPoints: HighDensityRoute["route"] = [{ ...route.route[0]! }]
    const snappedVias: HighDensityRoute["vias"] = []

    const appendPoint = (point: HighDensityRoute["route"][number]) => {
      const lastPoint = snappedPoints[snappedPoints.length - 1]
      if (
        lastPoint &&
        pointMatches(lastPoint, point) &&
        lastPoint.z === point.z
      ) {
        return
      }
      snappedPoints.push(point)
    }

    const appendVia = (via: PreplacedVia) => {
      const viaPoint = { x: via.x, y: via.y }
      if (
        !snappedVias.some((existingVia) => pointMatches(existingVia, viaPoint))
      ) {
        snappedVias.push(viaPoint)
      }
      assignedNetByViaId.set(via.viaId, routeNetKey)
      this.snappedViaCount++
    }

    for (let i = 1; i < route.route.length; i++) {
      const previousPoint = snappedPoints[snappedPoints.length - 1]!
      const currentPoint = route.route[i]!

      if (previousPoint.z === currentPoint.z) {
        appendPoint({ ...currentPoint })
        continue
      }

      const layerTransitionPoint = pointMatches(previousPoint, currentPoint)
        ? currentPoint
        : {
            x: (previousPoint.x + currentPoint.x) / 2,
            y: (previousPoint.y + currentPoint.y) / 2,
          }
      const snappedVia = this.findBestAvailableVia(
        layerTransitionPoint,
        routeNetKey,
        assignedNetByViaId,
        previousPoint,
        currentPoint,
        route.route[i + 1],
        route.traceThickness,
      )

      if (!snappedVia) {
        appendPoint({ ...currentPoint })
        continue
      }

      const viaPointOnPreviousLayer = {
        x: snappedVia.x,
        y: snappedVia.y,
        z: previousPoint.z,
      }
      const viaPointOnCurrentLayer = {
        x: snappedVia.x,
        y: snappedVia.y,
        z: currentPoint.z,
      }

      appendPoint(viaPointOnPreviousLayer)
      appendPoint(viaPointOnCurrentLayer)
      appendVia(snappedVia)

      if (!pointMatches(currentPoint, layerTransitionPoint)) {
        appendPoint({ ...currentPoint })
      }
    }

    return {
      ...structuredClone(route),
      viaDiameter: route.viaDiameter ?? this.params.defaultViaDiameter,
      route: snappedPoints,
      vias: snappedVias,
    }
  }

  getOutput(): HighDensityRoute[] {
    return this.snappedHdRoutes
  }

  override getConstructorParams() {
    return [this.params] as const
  }

  override visualize(): GraphicsObject {
    return {
      lines: this.snappedHdRoutes.flatMap((route) =>
        route.route.slice(1).map((point, index) => ({
          points: [route.route[index]!, { x: point.x, y: point.y }],
          strokeColor: "rgba(0, 160, 80, 0.8)",
          layer: `z${point.z}`,
          label: route.connectionName,
        })),
      ),
      circles: this.preplacedVias.map((via) => ({
        center: { x: via.x, y: via.y },
        radius: (via.diameter ?? this.params.defaultViaDiameter) / 2,
        stroke: "rgba(0, 160, 80, 0.8)",
        fill: "rgba(0, 160, 80, 0.15)",
        label: via.viaId,
      })),
      points: [],
      rects: [],
    }
  }
}
