import { arePipeline9RoutesOnSameNet, getPipeline9RouteCopperGeometry, type Pipeline9RouteViaSpan } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { Obstacle } from "lib/types"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"
import { getConnectionPortPointPairs } from "lib/utils/getConnectionPortPointPairs"

type Route = {
  A: PortPoint
  B: PortPoint
  connectionName: string
  rootConnectionName?: string
}
type LayeredObstacle = Obstacle & { __zLayers: number[] }

const CONTAINS_POINT_TOLERANCE = 1e-6

/**
 * Checks whether a point lies inside an obstacle rectangle.
 *
 * @param params - Point and obstacle to test.
 * @returns `true` when the point falls within the obstacle bounds.
 */
const pointInsideObstacle = (params: {
  point: Pick<PortPoint, "x" | "y">
  obstacle: Obstacle
}) => {
  const { point, obstacle } = params
  const halfWidth = obstacle.width / 2 + CONTAINS_POINT_TOLERANCE
  const halfHeight = obstacle.height / 2 + CONTAINS_POINT_TOLERANCE

  return (
    Math.abs(point.x - obstacle.center.x) <= halfWidth &&
    Math.abs(point.y - obstacle.center.y) <= halfHeight
  )
}

/**
 * Determines whether an obstacle belongs to the same net as a route.
 *
 * @param params - Obstacle and route connectivity inputs.
 * @returns `true` when the obstacle may be traversed by the route.
 */
const obstacleIsConnectedToRoute = (params: {
  obstacle: Obstacle
  connectionName: string
  connMap?: ConnectivityMap
}) =>
  params.obstacle.connectedTo.some(
    (id) =>
      id === params.connectionName ||
      (params.connMap?.areIdsConnected(params.connectionName, id) ?? false),
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
    fixedHdRoutes?: HighDensityIntraNodeRoute[]
    allowBlindAndBuriedVias?: boolean
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

    const conductors = this.routes.map((route) => {
      const obstacle = this.getContainingThroughObstacle(route)
      if (obstacle) return { type: "obstacle" as const, obstacle }
      const via = this.getContainingExistingVia(route, params)
      return via ? { type: "via" as const, via } : undefined
    })
    if (conductors.some((conductor) => !conductor)) {
      this.failed = true
      this.error = "No same-net multilayer obstacle contains every route"
      return
    }

    this.solvedRoutes.push(
      ...this.routes.map((route, routeIndex): HighDensityIntraNodeRoute => {
        const conductor = conductors[routeIndex]!
        return conductor.type === "obstacle"
          ? this.createRouteThroughObstacle(route, conductor.obstacle)
          : this.createRouteThroughExistingVia(route, conductor.via)
      }),
    )
    this.solved = true
  }

  /** Reuse a same-net barrel in this board-world routing cell (mm, +X right, +Y up). */
  private getContainingExistingVia(route: Route, params: {
    fixedHdRoutes?: HighDensityIntraNodeRoute[]
    layerCount?: number
    allowBlindAndBuriedVias?: boolean
  }): Pipeline9RouteViaSpan | undefined {
    const node = this.nodeWithPortPoints
    const candidates: Pipeline9RouteViaSpan[] = []
    for (const fixed of params.fixedHdRoutes ?? []) {
      const sameRoot = (route.rootConnectionName ?? route.connectionName) ===
        (fixed.rootConnectionName ?? fixed.connectionName)
      if (!sameRoot && (!this.connMap ||
        !arePipeline9RoutesOnSameNet({ left: route, right: fixed }, this.connMap))) continue
      const geometry = getPipeline9RouteCopperGeometry(fixed, {
        layerCount: params.layerCount ?? 2,
        allowBlindAndBuriedVias: params.allowBlindAndBuriedVias,
      })
      for (const via of geometry.viaSpans) {
        if (!fixed.vias.some((barrel) => Math.hypot(barrel.x - via.center.x,
          barrel.y - via.center.y) <= CONTAINS_POINT_TOLERANCE)) continue
        if (via.minZ > Math.min(route.A.z, route.B.z) || via.maxZ < Math.max(route.A.z, route.B.z)) continue
        if (Math.abs(via.center.x - node.center.x) > node.width / 2 + CONTAINS_POINT_TOLERANCE ||
          Math.abs(via.center.y - node.center.y) > node.height / 2 + CONTAINS_POINT_TOLERANCE) continue
        candidates.push(via)
      }
    }
    candidates.sort((a, b) =>
      Math.hypot(a.center.x - (route.A.x + route.B.x) / 2, a.center.y - (route.A.y + route.B.y) / 2) -
      Math.hypot(b.center.x - (route.A.x + route.B.x) / 2, b.center.y - (route.A.y + route.B.y) / 2),
    )
    return candidates[0]
  }

  private createRouteThroughExistingVia(route: Route, via: Pipeline9RouteViaSpan): HighDensityIntraNodeRoute {
    const transition = route.A.z !== route.B.z
    return {
      connectionName: route.connectionName,
      rootConnectionName: route.rootConnectionName,
      regionId: this.nodeWithPortPoints.capacityMeshNodeId,
      traceThickness: this.traceThickness,
      viaDiameter: via.diameter,
      vias: transition ? [via.center] : [],
      route: transition ? [route.A, { ...via.center, z: route.A.z },
        { ...via.center, z: route.B.z }, route.B] : [route.A, route.B],
    }
  }

  private createRouteThroughObstacle(
    route: Route,
    obstacle: LayeredObstacle,
  ): HighDensityIntraNodeRoute {
    const points: HighDensityIntraNodeRoute["route"] = [
      { x: route.A.x, y: route.A.y, z: route.A.z },
    ]
    if (route.A.z !== route.B.z) {
      // Change layers at the existing barrel, then approach each contact on
      // its own layer. A diagonal bridge would add copper on every layer.
      if (
        route.A.x !== obstacle.center.x ||
        route.A.y !== obstacle.center.y
      ) {
        points.push({ ...obstacle.center, z: route.A.z })
      }
      const transition = points[points.length - 1]!
      transition.toNextSegmentType = "through_obstacle"
      if (obstacle.circuitJsonMetadata) {
        transition.toNextSegmentCircuitJsonMetadata = obstacle.circuitJsonMetadata
      }
      points.push({ ...obstacle.center, z: route.B.z })
    }
    const last = points[points.length - 1]!
    if (
      route.A.z === route.B.z ||
      last.x !== route.B.x ||
      last.y !== route.B.y
    ) {
      points.push({ x: route.B.x, y: route.B.y, z: route.B.z })
    }
    return {
      connectionName: route.connectionName,
      rootConnectionName: route.rootConnectionName,
      regionId: this.nodeWithPortPoints.capacityMeshNodeId,
      route: points,
      traceThickness: this.traceThickness,
      viaDiameter: this.viaDiameter,
      vias: [],
    }
  }

  static isApplicable(params: {
    nodeWithPortPoints: NodeWithPortPoints
    obstacles?: Obstacle[]
    connMap?: ConnectivityMap
    layerCount?: number
    fixedHdRoutes?: HighDensityIntraNodeRoute[]
    allowBlindAndBuriedVias?: boolean
  }) {
    const solver = new SingleTransitionThroughObstacleIntraNodeSolver(params)
    return solver.solved
  }

  /**
   * Builds explicit route tasks from linked port-point pairs in the node.
   *
   * @returns Route tasks ready for obstacle validation.
   */
  private extractRoutesFromNode(): Route[] {
    const routes: Route[] = []
    const connectionGroups = new Map<string, PortPoint[]>()

    for (const connectedPort of this.nodeWithPortPoints.portPoints) {
      const { connectionName } = connectedPort
      if (!connectionGroups.has(connectionName)) {
        connectionGroups.set(connectionName, [])
      }
      connectionGroups.get(connectionName)!.push(connectedPort)
    }

    for (const [connectionName, points] of connectionGroups.entries()) {
      for (const [A, B] of getConnectionPortPointPairs(points)) {
        routes.push({
          A: { ...A },
          B: { ...B },
          connectionName,
          rootConnectionName: A.rootConnectionName ?? B.rootConnectionName,
        })
      }
    }
    return routes
  }

  /**
   * Finds a same-net multilayer obstacle that contains both route endpoints.
   *
   * @param route - Route to validate.
   * @returns Matching obstacle, or `null` when none exists.
   */
  private getContainingThroughObstacle(route: Route) {
    const zA = route.A.z
    const zB = route.B.z
    if (zA === undefined || zB === undefined) return null

    return (
      this.obstacles.find((obstacle) => {
        if (obstacle.representsFutureVia || obstacle.__zLayers.length < 2) {
          return false
        }
        if (
          !obstacle.__zLayers.includes(zA) ||
          !obstacle.__zLayers.includes(zB)
        ) {
          return false
        }
        if (
          !obstacleIsConnectedToRoute({
            obstacle,
            connectionName: route.connectionName,
            connMap: this.connMap,
          })
        ) {
          return false
        }
        return (
          pointInsideObstacle({ point: route.A, obstacle }) &&
          pointInsideObstacle({ point: route.B, obstacle })
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
        label: `through obstacle candidate\nz: ${obstacle.__zLayers.join(",")}`,
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
