import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { Obstacle } from "lib/types"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"

type Point = { x: number; y: number; z?: number; rootConnectionName?: string }
type Route = {
  A: Point
  B: Point
  connectionName: string
  rootConnectionName?: string
}
type LayeredObstacle = Obstacle & { zLayers: number[] }

const CONTAINS_POINT_TOLERANCE = 1e-6

const pointInsideObstacle = (
  point: Pick<Point, "x" | "y">,
  obstacle: Obstacle,
) => {
  const halfWidth = obstacle.width / 2 + CONTAINS_POINT_TOLERANCE
  const halfHeight = obstacle.height / 2 + CONTAINS_POINT_TOLERANCE

  return (
    Math.abs(point.x - obstacle.center.x) <= halfWidth &&
    Math.abs(point.y - obstacle.center.y) <= halfHeight
  )
}

const obstacleIsConnectedToRoute = (
  obstacle: Obstacle,
  connectionName: string,
  connMap?: ConnectivityMap,
) =>
  obstacle.connectedTo.some(
    (id) =>
      id === connectionName ||
      (connMap?.areIdsConnected(connectionName, id) ?? false),
  )

export class SingleTransitionThroughObstacleIntraNodeSolver extends BaseSolver {
  override getSolverName(): string {
    return "SingleTransitionThroughObstacleIntraNodeSolver"
  }

  nodeWithPortPoints: NodeWithPortPoints
  routes: Route[]
  obstacles: LayeredObstacle[]
  viaDiameter: number
  traceThickness: number
  connMap?: ConnectivityMap
  solvedRoutes: HighDensityIntraNodeRoute[] = []

  constructor(params: {
    nodeWithPortPoints: NodeWithPortPoints
    obstacles?: Obstacle[]
    connMap?: ConnectivityMap
    layerCount?: number
    viaDiameter?: number
    traceThickness?: number
  }) {
    super()

    this.nodeWithPortPoints = params.nodeWithPortPoints
    this.obstacles = createObjectsWithZLayers(
      params.obstacles ?? [],
      params.layerCount ?? 2,
    )
    this.connMap = params.connMap
    this.viaDiameter = params.viaDiameter ?? 0.3
    this.traceThickness = params.traceThickness ?? 0.15
    this.routes = this.extractRoutesFromNode()

    if (this.routes.length === 0) {
      this.failed = true
      this.error = "Expected at least 1 route"
      return
    }

    if (
      this.routes.some(
        (route) => route.A.z === undefined || route.B.z === undefined,
      )
    ) {
      this.failed = true
      this.error = "Route points should have predefined z values"
      return
    }

    if (!this.routes.some((route) => route.A.z !== route.B.z)) {
      this.failed = true
      this.error = "No route transitions through an obstacle"
      return
    }

    const containingObstacles = this.routes.map((route) =>
      this.getContainingThroughObstacle(route),
    )
    if (containingObstacles.some((obstacle) => !obstacle)) {
      this.failed = true
      this.error = "No same-net multilayer obstacle contains every route"
      return
    }

    this.solvedRoutes.push(
      ...this.routes.map((route) => ({
        connectionName: route.connectionName,
        rootConnectionName: route.rootConnectionName,
        route: [
          {
            x: route.A.x,
            y: route.A.y,
            z: route.A.z!,
            ...(route.A.z !== route.B.z
              ? { toNextSegmentType: "through_obstacle" as const }
              : {}),
          },
          { x: route.B.x, y: route.B.y, z: route.B.z! },
        ],
        traceThickness: this.traceThickness,
        viaDiameter: this.viaDiameter,
        vias: [],
      })),
    )
    this.solved = true
  }

  static isApplicable(params: {
    nodeWithPortPoints: NodeWithPortPoints
    obstacles?: Obstacle[]
    connMap?: ConnectivityMap
    layerCount?: number
  }) {
    const solver = new SingleTransitionThroughObstacleIntraNodeSolver(params)
    return solver.solved
  }

  private extractRoutesFromNode(): Route[] {
    const routes: Route[] = []
    const connectionGroups = new Map<string, Point[]>()

    for (const connectedPort of this.nodeWithPortPoints.portPoints) {
      const { connectionName, rootConnectionName } = connectedPort
      if (!connectionGroups.has(connectionName)) {
        connectionGroups.set(connectionName, [])
      }
      connectionGroups.get(connectionName)!.push({
        ...connectedPort,
        rootConnectionName,
      })
    }

    for (const [connectionName, points] of connectionGroups.entries()) {
      if (points.length === 2) {
        routes.push({
          A: { ...points[0]! },
          B: { ...points[1]! },
          connectionName,
          rootConnectionName:
            points[0]?.rootConnectionName ?? points[1]?.rootConnectionName,
        })
      }
    }
    return routes
  }

  private getContainingThroughObstacle(route: Route) {
    const zA = route.A.z
    const zB = route.B.z
    if (zA === undefined || zB === undefined) return null

    return (
      this.obstacles.find((obstacle) => {
        if (obstacle.zLayers.length < 2) {
          return false
        }
        if (!obstacle.zLayers.includes(zA) || !obstacle.zLayers.includes(zB)) {
          return false
        }
        if (
          !obstacleIsConnectedToRoute(
            obstacle,
            route.connectionName,
            this.connMap,
          )
        ) {
          return false
        }
        return (
          pointInsideObstacle(route.A, obstacle) &&
          pointInsideObstacle(route.B, obstacle)
        )
      }) ?? null
    )
  }

  _step() {
    this.solved = true
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    for (const obstacle of this.obstacles) {
      graphics.rects!.push({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        fill: "rgba(128, 0, 128, 0.2)",
        stroke: "rgba(128, 0, 128, 0.6)",
        label: `through obstacle candidate\nz: ${obstacle.zLayers.join(",")}`,
      })
    }

    for (const route of this.solvedRoutes) {
      graphics.lines!.push({
        points: route.route,
        strokeColor: "rgba(0, 180, 0, 0.8)",
        strokeDash: "4, 3",
        strokeWidth: route.traceThickness,
        label: `${route.connectionName} through_obstacle`,
      })
      for (const point of route.route) {
        graphics.points!.push({
          x: point.x,
          y: point.y,
          color: "green",
          label: `${route.connectionName}\nz: ${point.z}`,
        })
      }
    }

    return graphics
  }
}
