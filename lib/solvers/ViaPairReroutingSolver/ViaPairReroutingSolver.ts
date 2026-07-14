import { distance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"
import { BaseSolver } from "../BaseSolver"
import { SingleHighDensityRouteSolver } from "../HighDensitySolver/SingleHighDensityRouteSolver"

type RoutePoint = HighDensityRoute["route"][number]

type ViaPairCandidate = {
  firstTransitionIndex: number
  secondTransitionIndex: number
  start: RoutePoint
  end: RoutePoint
  viaLocations: Array<{ x: number; y: number }>
  originalSpanLength: number
}

type ActiveReroute = {
  candidate: ViaPairCandidate
  solver: SingleHighDensityRouteSolver
}

export interface ViaPairReroutingSolverInput {
  hdRoutes: ReadonlyArray<HighDensityRoute>
  obstacles: ReadonlyArray<Obstacle>
  connMap: ConnectivityMap
  layerCount: number
  outline?: ReadonlyArray<{ x: number; y: number }>
  defaultViaDiameter: number
  minTraceToPadEdgeClearance?: number
  /** Distance-equivalent cost of retaining one via, in millimeters. */
  viaDistanceCost?: number
}

const DEFAULT_VIA_DISTANCE_COST = 20
const POINT_EPSILON = 1e-6

/**
 * Attempts to replace the portion of a trace from one via to any later via
 * that returns to the starting layer with a single-layer path. Other traces
 * are supplied to the pathfinder as immutable obstacles, so a successful
 * attempt only changes the trace being simplified.
 */
export class ViaPairReroutingSolver extends BaseSolver {
  override getSolverName(): string {
    return "ViaPairReroutingSolver"
  }

  readonly viaDistanceCost: number
  private readonly input: Omit<
    ViaPairReroutingSolverInput,
    "hdRoutes" | "obstacles" | "viaDistanceCost"
  > & {
    obstacles: Array<Obstacle & { __zLayers: number[] }>
  }

  readonly optimizedHdRoutes: HighDensityRoute[]
  private currentRouteIndex = 0
  private candidateQueue: ViaPairCandidate[] = []
  private candidateQueueInitialized = false
  private activeReroute: ActiveReroute | null = null
  private rerouteAttempts = 0

  /** Bounds the optional simplification work on via-heavy boards. */
  MAX_REROUTE_ATTEMPTS = 50

  constructor(input: ViaPairReroutingSolverInput) {
    super()
    if ((input.viaDistanceCost ?? DEFAULT_VIA_DISTANCE_COST) < 0) {
      throw new Error("viaDistanceCost must be non-negative")
    }

    this.viaDistanceCost =
      input.viaDistanceCost ?? DEFAULT_VIA_DISTANCE_COST
    this.input = {
      connMap: input.connMap,
      layerCount: input.layerCount,
      outline: input.outline,
      defaultViaDiameter: input.defaultViaDiameter,
      minTraceToPadEdgeClearance: input.minTraceToPadEdgeClearance,
      obstacles: createObjectsWithZLayers(input.obstacles, input.layerCount),
    }
    this.optimizedHdRoutes = input.hdRoutes.map((route) => ({
      ...route,
      route: route.route.map((point) => ({ ...point })),
      vias: route.vias.map((via) => ({ ...via })),
      jumpers: route.jumpers?.map((jumper) => ({
        ...jumper,
        start: { ...jumper.start },
        end: { ...jumper.end },
      })),
    }))
    this.MAX_ITERATIONS = 100e6
  }

  private pointsShareLocation(
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): boolean {
    return distance(a, b) <= POINT_EPSILON
  }

  private routeHasViaAt(
    route: HighDensityRoute,
    point: { x: number; y: number },
  ): boolean {
    return route.vias.some((via) => this.pointsShareLocation(via, point))
  }

  private getNextCandidate(route: HighDensityRoute): ViaPairCandidate | null {
    const transitions: number[] = []
    for (let i = 0; i < route.route.length - 1; i++) {
      if (route.route[i].z !== route.route[i + 1].z) transitions.push(i)
    }

    if (!this.candidateQueueInitialized) {
      this.candidateQueueInitialized = true
      for (
        let firstTransitionPosition = 0;
        firstTransitionPosition < transitions.length - 1;
        firstTransitionPosition++
      ) {
        for (
          let secondTransitionPosition = transitions.length - 1;
          secondTransitionPosition > firstTransitionPosition;
          secondTransitionPosition--
        ) {
          const firstTransitionIndex = transitions[firstTransitionPosition]
          const secondTransitionIndex = transitions[secondTransitionPosition]
          const start = route.route[firstTransitionIndex]
          const end = route.route[secondTransitionIndex + 1]
          if (start.z !== end.z) continue

          const transitionIndices = transitions.slice(
            firstTransitionPosition,
            secondTransitionPosition + 1,
          )
          const viaLocations: Array<{ x: number; y: number }> = []
          const hasInvalidTransition = transitionIndices.some(
            (transitionIndex) => {
              const beforeVia = route.route[transitionIndex]
              const afterVia = route.route[transitionIndex + 1]
              if (
                !this.pointsShareLocation(beforeVia, afterVia) ||
                beforeVia.toNextSegmentType === "through_obstacle" ||
                !this.routeHasViaAt(route, beforeVia)
              ) {
                return true
              }
              if (
                !viaLocations.some((via) =>
                  this.pointsShareLocation(via, beforeVia),
                )
              ) {
                viaLocations.push({ x: beforeVia.x, y: beforeVia.y })
              }
              return false
            },
          )
          const containsJumperPad = route.route
            .slice(firstTransitionIndex, secondTransitionIndex + 2)
            .some((point) => point.insideJumperPad)
          if (hasInvalidTransition || containsJumperPad) continue

          let originalSpanLength = 0
          for (let i = firstTransitionIndex; i <= secondTransitionIndex; i++) {
            originalSpanLength += distance(route.route[i], route.route[i + 1])
          }

          this.candidateQueue.push({
            firstTransitionIndex,
            secondTransitionIndex,
            start,
            end,
            viaLocations,
            originalSpanLength,
          })
        }
      }
    }

    return this.candidateQueue.shift() ?? null
  }

  private obstacleIsSameNet(
    route: HighDensityRoute,
    obstacle: Obstacle,
  ): boolean {
    const routeIds = [route.connectionName, route.rootConnectionName].filter(
      (id): id is string => id !== undefined,
    )
    return routeIds.some((routeId) =>
      obstacle.connectedTo.some(
        (connectedId) =>
          connectedId === routeId ||
          this.input.connMap.areIdsConnected(connectedId, routeId),
      ),
    )
  }

  private getObstacleCorners(
    obstacle: Obstacle,
  ): Array<{ x: number; y: number }> {
    const rotation = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    const halfWidth = obstacle.width / 2
    const halfHeight = obstacle.height / 2
    return [
      { x: -halfWidth, y: -halfHeight },
      { x: halfWidth, y: -halfHeight },
      { x: halfWidth, y: halfHeight },
      { x: -halfWidth, y: halfHeight },
    ].map((point) => ({
      x: obstacle.center.x + point.x * cos - point.y * sin,
      y: obstacle.center.y + point.x * sin + point.y * cos,
    }))
  }

  private getObstacleRoutes(
    route: HighDensityRoute,
    targetZ: number,
  ): HighDensityRoute[] {
    const otherRoutes = this.optimizedHdRoutes.filter(
      (_, routeIndex) => routeIndex !== this.currentRouteIndex,
    )
    const obstacleLoops = this.input.obstacles
      .filter(
        (obstacle) =>
          obstacle.__zLayers.includes(targetZ) &&
          !this.obstacleIsSameNet(route, obstacle),
      )
      .map((obstacle, obstacleIndex): HighDensityRoute => {
        const corners = this.getObstacleCorners(obstacle)
        return {
          connectionName: `__via_pair_obstacle_${obstacleIndex.toString()}`,
          traceThickness: 0,
          viaDiameter: this.input.defaultViaDiameter,
          route: [...corners, corners[0]].map((point) => ({
            ...point,
            z: targetZ,
          })),
          vias: [],
        }
      })

    const outlineRoute: HighDensityRoute[] =
      this.input.outline && this.input.outline.length >= 3
        ? [
            {
              connectionName: "__via_pair_board_outline",
              traceThickness: 0,
              viaDiameter: this.input.defaultViaDiameter,
              route: [...this.input.outline, this.input.outline[0]].map(
                (point) => ({ ...point, z: targetZ }),
              ),
              vias: [],
            },
          ]
        : []

    return otherRoutes.concat(obstacleLoops, outlineRoute)
  }

  private getRerouteBounds(
    route: HighDensityRoute,
    candidate: ViaPairCandidate,
    obstacleRoutes: HighDensityRoute[],
  ): { minX: number; maxX: number; minY: number; maxY: number } {
    const allPoints = obstacleRoutes
      .flatMap((obstacleRoute) => obstacleRoute.route)
      .concat(route.route, [candidate.start, candidate.end])
    const globalBounds = allPoints.reduce(
      (bounds, point) => ({
        minX: Math.min(bounds.minX, point.x),
        maxX: Math.max(bounds.maxX, point.x),
        minY: Math.min(bounds.minY, point.y),
        maxY: Math.max(bounds.maxY, point.y),
      }),
      { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
    )
    const maximumAcceptedLength =
      candidate.originalSpanLength +
      this.viaDistanceCost * candidate.viaLocations.length
    const searchMargin = Math.max(maximumAcceptedLength, 1)

    return {
      minX: Math.max(
        globalBounds.minX - 1,
        Math.min(candidate.start.x, candidate.end.x) - searchMargin,
      ),
      maxX: Math.min(
        globalBounds.maxX + 1,
        Math.max(candidate.start.x, candidate.end.x) + searchMargin,
      ),
      minY: Math.max(
        globalBounds.minY - 1,
        Math.min(candidate.start.y, candidate.end.y) - searchMargin,
      ),
      maxY: Math.min(
        globalBounds.maxY + 1,
        Math.max(candidate.start.y, candidate.end.y) + searchMargin,
      ),
    }
  }

  private startReroute(
    route: HighDensityRoute,
    candidate: ViaPairCandidate,
  ): void {
    const obstacleRoutes = this.getObstacleRoutes(route, candidate.start.z)
    const maximumObstacleTraceThickness = Math.max(
      0,
      ...obstacleRoutes.map((obstacleRoute) => obstacleRoute.traceThickness),
    )
    const maximumObstacleViaDiameter = Math.max(
      route.viaDiameter ?? this.input.defaultViaDiameter,
      ...obstacleRoutes.map((obstacleRoute) => obstacleRoute.viaDiameter),
    )
    const obstacleMargin = this.input.minTraceToPadEdgeClearance ?? 0.1
    const solver = new SingleHighDensityRouteSolver({
      connectionName: route.connectionName,
      rootConnectionName: route.rootConnectionName,
      obstacleRoutes,
      minDistBetweenEnteringPoints: Math.max(
        route.traceThickness +
          (this.input.minTraceToPadEdgeClearance ?? 0.1),
        0.2,
      ),
      bounds: this.getRerouteBounds(route, candidate, obstacleRoutes),
      A: candidate.start,
      B: candidate.end,
      viaDiameter: maximumObstacleViaDiameter,
      traceThickness: route.traceThickness,
      obstacleMargin,
      layerCount: this.input.layerCount,
      availableZ: [candidate.start.z],
      connMap: this.input.connMap,
      nearbySegmentClearance:
        route.traceThickness / 2 +
        maximumObstacleTraceThickness / 2 +
        obstacleMargin,
    })
    // A failed simplification attempt is a valid no-op, so keep each search
    // small enough that dense boards can still complete the simplification stage.
    solver.MAX_ITERATIONS = 250
    this.rerouteAttempts++
    this.activeReroute = { candidate, solver }
    this.activeSubSolver = solver
  }

  private simplifyPath(points: RoutePoint[]): RoutePoint[] {
    const deduplicated = points.filter(
      (point, index) =>
        index === 0 || !this.pointsShareLocation(point, points[index - 1]),
    )
    if (deduplicated.length <= 2) return deduplicated

    const simplified: RoutePoint[] = [deduplicated[0]]
    for (let i = 1; i < deduplicated.length - 1; i++) {
      const previous = simplified[simplified.length - 1]
      const current = deduplicated[i]
      const next = deduplicated[i + 1]
      const cross =
        (current.x - previous.x) * (next.y - current.y) -
        (current.y - previous.y) * (next.x - current.x)
      const directionDotProduct =
        (current.x - previous.x) * (next.x - current.x) +
        (current.y - previous.y) * (next.y - current.y)
      if (
        Math.abs(cross) > POINT_EPSILON ||
        directionDotProduct <= POINT_EPSILON
      ) {
        simplified.push(current)
      }
    }
    simplified.push(deduplicated[deduplicated.length - 1])
    return simplified
  }

  private removeViaOnce(
    vias: HighDensityRoute["vias"],
    location: { x: number; y: number },
  ): HighDensityRoute["vias"] {
    const index = vias.findIndex((via) =>
      this.pointsShareLocation(via, location),
    )
    if (index === -1) return vias
    return vias.slice(0, index).concat(vias.slice(index + 1))
  }

  private acceptReroute(activeReroute: ActiveReroute): void {
    const route = this.optimizedHdRoutes[this.currentRouteIndex]
    const solvedPath = activeReroute.solver.solvedPath
    if (!solvedPath || solvedPath.vias.length > 0) return

    const candidatePath = this.simplifyPath(solvedPath.route)
    const candidateLength = candidatePath.slice(1).reduce(
      (total, point, index) => total + distance(candidatePath[index], point),
      0,
    )
    const currentCost =
      activeReroute.candidate.originalSpanLength +
      this.viaDistanceCost * activeReroute.candidate.viaLocations.length
    if (candidateLength >= currentCost) return

    const { firstTransitionIndex, secondTransitionIndex, start, end } =
      activeReroute.candidate
    const firstPoint = { ...start }
    delete firstPoint.toNextSegmentType
    const replacementPath: RoutePoint[] = candidatePath.map((point) => ({
      x: point.x,
      y: point.y,
      z: start.z,
    }))
    replacementPath[0] = firstPoint
    replacementPath[replacementPath.length - 1] = { ...end }

    let vias = route.vias
    for (const viaLocation of activeReroute.candidate.viaLocations) {
      vias = this.removeViaOnce(vias, viaLocation)
    }
    this.optimizedHdRoutes[this.currentRouteIndex] = {
      ...route,
      route: route.route
        .slice(0, firstTransitionIndex)
        .concat(replacementPath, route.route.slice(secondTransitionIndex + 2)),
      vias,
    }
    this.candidateQueue = []
    this.candidateQueueInitialized = false
  }

  _step(): void {
    if (this.activeReroute) {
      const activeReroute = this.activeReroute
      activeReroute.solver.step()
      if (activeReroute.solver.solved) this.acceptReroute(activeReroute)
      if (activeReroute.solver.solved || activeReroute.solver.failed) {
        this.activeReroute = null
        this.activeSubSolver = null
      }
      return
    }

    const route = this.optimizedHdRoutes[this.currentRouteIndex]
    if (!route || this.rerouteAttempts >= this.MAX_REROUTE_ATTEMPTS) {
      this.solved = true
      return
    }

    const candidate = this.getNextCandidate(route)
    if (candidate) {
      this.startReroute(route, candidate)
      return
    }

    this.currentRouteIndex++
    this.candidateQueue = []
    this.candidateQueueInitialized = false
  }

  visualize(): GraphicsObject {
    if (this.activeReroute) return this.activeReroute.solver.visualize()

    const graphics: GraphicsObject = {
      coordinateSystem: "cartesian",
      title: "Via Pair Rerouting Solver",
      lines: [],
      circles: [],
    }
    for (const route of this.optimizedHdRoutes) {
      for (let i = 0; i < route.route.length - 1; i++) {
        if (route.route[i].z !== route.route[i + 1].z) continue
        graphics.lines!.push({
          points: [route.route[i], route.route[i + 1]],
          strokeWidth: route.traceThickness,
          strokeColor: route.route[i].z === 0 ? "red" : "blue",
        })
      }
      for (const via of route.vias) {
        graphics.circles!.push({
          center: via,
          radius: route.viaDiameter / 2,
          fill: "rgba(255, 0, 255, 0.5)",
        })
      }
    }
    return graphics
  }
}
