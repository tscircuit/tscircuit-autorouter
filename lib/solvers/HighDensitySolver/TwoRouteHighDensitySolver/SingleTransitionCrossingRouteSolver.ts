import { BaseSolver } from "lib/solvers/BaseSolver"
import {
  NodeWithPortPoints,
  HighDensityIntraNodeRoute,
} from "lib/types/high-density-types"
import {
  distance,
  pointToSegmentDistance,
  doSegmentsIntersect,
  clamp,
} from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
import { getIntraNodeCrossings } from "lib/utils/getIntraNodeCrossings"
import { findCircleLineIntersections } from "./findCircleLineIntersections"
import { findClosestPointToABCWithinBounds } from "lib/utils/findClosestPointToABCWithinBounds"
import { calculatePerpendicularPointsAtDistance } from "lib/utils/calculatePointsAtDistance"
import { snapToNearestBound } from "lib/utils/snapToNearestBound"
import { findPointToGetAroundCircle } from "lib/utils/findPointToGetAroundCircle"
import {
  calculateTraversalPercentages,
  pointToAngle,
} from "./calculateSideTraversal"
import { computeTurnDirection } from "./computeTurnDirection"

type Point = { x: number; y: number; z?: number }
type Route = {
  A: Point
  B: Point
  connectionName: string
}

export class SingleTransitionCrossingRouteSolver extends BaseSolver {
  // Input parameters
  nodeWithPortPoints: NodeWithPortPoints
  routes: Route[]

  // Configuration parameters
  viaDiameter: number
  traceThickness: number
  obstacleMargin: number
  layerCount: number = 2

  debugViaPositions: {
    via: Point
  }[]

  // Solution state
  solvedRoutes: HighDensityIntraNodeRoute[] = []

  // Bounds
  bounds: { minX: number; maxX: number; minY: number; maxY: number }

  constructor(params: {
    nodeWithPortPoints: NodeWithPortPoints
    viaDiameter?: number
    traceThickness?: number
    obstacleMargin?: number
    layerCount?: number
  }) {
    super()

    this.nodeWithPortPoints = params.nodeWithPortPoints
    this.viaDiameter = params?.viaDiameter ?? 0.6
    this.traceThickness = params?.traceThickness ?? 0.15
    this.obstacleMargin = params?.obstacleMargin ?? 0.1
    this.layerCount = params?.layerCount ?? 2
    this.debugViaPositions = []

    // Extract routes from the node data
    this.routes = this.extractRoutesFromNode()

    // Calculate bounds
    this.bounds = this.calculateBounds()

    if (this.routes.length !== 2) {
      this.failed = true
      this.error = `Expected 2 routes, but got ${this.routes.length}`
      return
    }

    const [routeA, routeB] = this.routes

    // Check if one route has a layer transition and the other doesn't
    const routeAHasTransition = routeA.A.z !== routeA.B.z
    const routeBHasTransition = routeB.A.z !== routeB.B.z

    // We need exactly one route with a transition
    if (
      (routeAHasTransition && routeBHasTransition) ||
      (!routeAHasTransition && !routeBHasTransition)
    ) {
      this.failed = true
      this.error = "Exactly one route must have a layer transition"
      return
    }
  }

  /**
   * Extract routes that need to be connected from the node data
   */
  private extractRoutesFromNode(): Route[] {
    const routes: Route[] = []
    const connectedPorts = this.nodeWithPortPoints.portPoints!

    // Group ports by connection name
    const connectionGroups = new Map<string, Point[]>()

    for (const connectedPort of connectedPorts) {
      const { connectionName } = connectedPort
      if (!connectionGroups.has(connectionName)) {
        connectionGroups.set(connectionName, [])
      }
      connectionGroups.get(connectionName)?.push(connectedPort)
    }

    // Create routes for each connection (assuming each connection has exactly 2 points)
    for (const [connectionName, points] of connectionGroups.entries()) {
      if (points.length === 2) {
        routes.push({
          A: { ...points[0], z: points[0].z ?? 0 },
          B: { ...points[1], z: points[1].z ?? 0 },
          connectionName,
        })
      }
    }

    return routes
  }

  /**
   * Calculate the bounding box of the node
   */
  private calculateBounds() {
    return {
      minX:
        this.nodeWithPortPoints.center.x - this.nodeWithPortPoints.width / 2,
      maxX:
        this.nodeWithPortPoints.center.x + this.nodeWithPortPoints.width / 2,
      minY:
        this.nodeWithPortPoints.center.y - this.nodeWithPortPoints.height / 2,
      maxY:
        this.nodeWithPortPoints.center.y + this.nodeWithPortPoints.height / 2,
    }
  }

  /**
   * Check if two routes are crossing
   */
  private doRoutesCross(routeA: Route, routeB: Route): boolean {
    // For this specific solver, we want to check if the 2D projections intersect
    // (ignoring z values)
    return doSegmentsIntersect(routeA.A, routeA.B, routeB.A, routeB.B)
  }

  private calculateViaPosition(
    transitionRoute: Route,
    flatRoute: Route,
  ): Point | null {
    const flatRouteZ = flatRoute.A.z
    const ntrP1 =
      transitionRoute.A.z !== flatRouteZ ? transitionRoute.A : transitionRoute.B

    // ntrP1 is always on the opposite layer as the flat route, the trace must always
    // weave between ntrP1 and the via
    // The via must also be far enough from the flat route
    const marginFromBorderWithTrace =
      this.obstacleMargin * 2 + this.viaDiameter / 2 + this.traceThickness
    const marginFromBorderWithoutTrace =
      this.obstacleMargin + this.viaDiameter / 2

    const A = flatRoute.A
    const B = ntrP1
    const C = flatRoute.B

    const turnDirection = computeTurnDirection(A, B, C, this.bounds)
    const sideTraversal = calculateTraversalPercentages(
      A,
      B,
      C,
      this.bounds,
      turnDirection,
    )

    const viaBounds = {
      minX:
        this.bounds.minX +
        (sideTraversal.left > 0.5
          ? marginFromBorderWithTrace
          : marginFromBorderWithoutTrace),
      minY:
        this.bounds.minY +
        (sideTraversal.bottom > 0.5
          ? marginFromBorderWithTrace
          : marginFromBorderWithoutTrace),
      maxX:
        this.bounds.maxX -
        (sideTraversal.right > 0.5
          ? marginFromBorderWithTrace
          : marginFromBorderWithoutTrace),
      maxY:
        this.bounds.maxY -
        (sideTraversal.top > 0.5
          ? marginFromBorderWithTrace
          : marginFromBorderWithoutTrace),
    }

    if (viaBounds.maxY < viaBounds.minY) {
      viaBounds.minY = (viaBounds.minY + viaBounds.maxY) / 2
      viaBounds.maxY = viaBounds.minY
    }

    if (viaBounds.maxX < viaBounds.minX) {
      viaBounds.minX = (viaBounds.minX + viaBounds.maxX) / 2
      viaBounds.maxX = viaBounds.minX
    }

    return findClosestPointToABCWithinBounds(
      A,
      B,
      C,
      marginFromBorderWithTrace,
      viaBounds,
    )
  }
  /**
   * Create a single transition route with properly placed via
   */
  private createTransitionRoute(
    start: Point,
    end: Point,
    via: Point,
    connectionName: string,
  ): HighDensityIntraNodeRoute {
    // Create the route path with layer transition at the via
    const route = [
      { x: start.x, y: start.y, z: start.z ?? 0 },
      { x: via.x, y: via.y, z: start.z ?? 0 },
      { x: via.x, y: via.y, z: end.z ?? 0 },
      { x: end.x, y: end.y, z: end.z ?? 0 },
    ]

    return {
      connectionName,
      route,
      traceThickness: this.traceThickness,
      viaDiameter: this.viaDiameter,
      vias: [via],
    }
  }

  /**
   * Create the non-transition route
   */
  private createFlatRoute(
    flatStart: Point,
    flatEnd: Point,
    via: Point,
    otherRouteStart: Point,
    otherRouteEnd: Point,
    flatRouteConnectionName: string,
  ): HighDensityIntraNodeRoute {
    const ntrP1 =
      otherRouteStart.z !== flatStart.z ? otherRouteStart : otherRouteEnd
    // We need to navigate around the via

    const middle = (a: Point, b: Point) => {
      return {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
      }
    }

    const middleWithMargin = (
      a: Point,
      aMargin: number,
      b: Point,
      bMargin: number,
    ) => {
      const dx = b.x - a.x
      const dy = b.y - a.y

      const effectiveA = {
        x: a.x + dx * aMargin,
        y: a.y + dy * aMargin,
      }

      const effectiveB = {
        x: b.x - dx * bMargin,
        y: b.y - dy * bMargin,
      }

      return middle(effectiveA, effectiveB)
    }

    const minDistFromViaToTrace =
      this.viaDiameter / 2 + this.traceThickness / 2 + this.obstacleMargin
    const p2 = middleWithMargin(
      via,
      this.viaDiameter,
      otherRouteStart.z !== flatStart.z ? otherRouteStart : otherRouteEnd,
      this.traceThickness,
    )
    const viaCircle = {
      center: { x: via.x, y: via.y },
      radius: minDistFromViaToTrace,
    }
    const p1 = findPointToGetAroundCircle(flatStart, p2, viaCircle).E
    const p3 = findPointToGetAroundCircle(p2, flatEnd, viaCircle).E

    // Determine if we need p1 or if we can just go from flatStart to p2 without
    // intersecting the via
    // const p1IsNeeded =
    //   pointToSegmentDistance(via, flatStart, p2) < minDistFromViaToTrace
    // const p3IsNeeded = pointToSegmentDistance(via, p2, flatEnd) < minDistFromViaToTrace

    // flatStart -> p0_5 -> p1 -> p1_5 -> p2 -> p2_5 -> p3 -> p3_5 -> flatEnd
    const p0_5 = findPointToGetAroundCircle(flatStart, p1, viaCircle).E
    const p1_5 = findPointToGetAroundCircle(p1, p2, viaCircle).E
    const p2_5 = findPointToGetAroundCircle(p2, p3, viaCircle).E
    const p3_5 = findPointToGetAroundCircle(p3, flatEnd, viaCircle).E

    const p2_better = findPointToGetAroundCircle(p1_5, p2_5, viaCircle).E

    // We need to navigate around the via
    return {
      connectionName: flatRouteConnectionName,
      route: [
        { x: flatStart.x, y: flatStart.y, z: flatStart.z ?? 0 },
        { x: p0_5.x, y: p0_5.y, z: flatStart.z ?? 0 },
        { x: p1.x, y: p1.y, z: flatStart.z ?? 0 },
        { x: p1_5.x, y: p1_5.y, z: flatStart.z ?? 0 },
        // { x: p2.x, y: p2.y, z: flatStart.z ?? 0 },
        { x: p2_better.x, y: p2_better.y, z: flatStart.z ?? 0 },
        { x: p2_5.x, y: p2_5.y, z: flatStart.z ?? 0 },
        { x: p3.x, y: p3.y, z: flatStart.z ?? 0 },
        { x: p3_5.x, y: p3_5.y, z: flatStart.z ?? 0 },
        { x: flatEnd.x, y: flatEnd.y, z: flatEnd.z ?? 0 },
      ],
      traceThickness: this.traceThickness,
      viaDiameter: this.viaDiameter,
      vias: [],
    }
  }

  /**
   * Try to solve with one route having a transition and the other staying flat
   */
  private trySolve(): boolean {
    const [routeA, routeB] = this.routes

    // Determine which route has the transition
    const routeAHasTransition = routeA.A.z !== routeA.B.z

    const transitionRoute = routeAHasTransition ? routeA : routeB
    const flatRoute = routeAHasTransition ? routeB : routeA

    const viaPosition = this.calculateViaPosition(transitionRoute, flatRoute)
    if (viaPosition) {
      this.debugViaPositions.push({ via: viaPosition })
    } else {
      return false
    }

    // Create transition route with via
    const transitionRouteSolution = this.createTransitionRoute(
      transitionRoute.A,
      transitionRoute.B,
      viaPosition,
      transitionRoute.connectionName,
    )

    // Create flat route
    const flatRouteSolution = this.createFlatRoute(
      flatRoute.A,
      flatRoute.B,
      viaPosition,
      transitionRoute.A,
      transitionRoute.B,
      flatRoute.connectionName,
    )

    this.solvedRoutes.push(transitionRouteSolution, flatRouteSolution)
    return true
  }

  /**
   * Main step method that attempts to solve the routes
   */
  _step() {
    // Check if routes are actually crossing
    if (!this.doRoutesCross(this.routes[0], this.routes[1])) {
      this.failed = true
      this.error =
        "Can only solve routes that have a single transition crossing"
      return
    }

    // Try to solve
    if (this.trySolve()) {
      this.solved = true
      return
    }

    // If approach fails, mark as failed
    this.failed = true
    this.error = "Failed to find a valid via position and route path"
  }

  /**
   * Visualization for debugging
   */
  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    // Draw PCB bounds
    graphics.rects!.push({
      center: {
        x: (this.bounds.minX + this.bounds.maxX) / 2,
        y: (this.bounds.minY + this.bounds.maxY) / 2,
      },
      width: this.bounds.maxX - this.bounds.minX,
      height: this.bounds.maxY - this.bounds.minY,
      stroke: "rgba(0, 0, 0, 0.5)",
      fill: "rgba(240, 240, 240, 0.1)",
      label: "PCB Bounds",
    })

    // Draw original routes
    for (const route of this.routes) {
      // Draw endpoints
      graphics.points!.push({
        x: route.A.x,
        y: route.A.y,
        label: `${route.connectionName} start (z=${route.A.z})`,
        color: "orange",
      })

      graphics.points!.push({
        x: route.B.x,
        y: route.B.y,
        label: `${route.connectionName} end (z=${route.B.z})`,
        color: "orange",
      })

      // Draw direct connection line
      graphics.lines!.push({
        points: [route.A, route.B],
        strokeColor: "rgba(255, 0, 0, 0.5)",
        label: `${route.connectionName} direct`,
      })
    }

    // Draw debug via positions (even if solution failed)
    for (let i = 0; i < this.debugViaPositions.length; i++) {
      const { via } = this.debugViaPositions[i]

      // Draw computed via
      graphics.circles!.push({
        center: via,
        radius: this.viaDiameter / 2,
        fill: "rgba(255, 165, 0, 0.7)",
        stroke: "rgba(0, 0, 0, 0.5)",
        label: `Computed Via (attempt ${i + 1})`,
      })

      // Draw safety margin around via
      const safetyMargin = this.viaDiameter / 2 + this.obstacleMargin
      graphics.circles!.push({
        center: via,
        radius: safetyMargin,
        stroke: "rgba(255, 165, 0, 0.7)",
        fill: "rgba(0, 0, 0, 0)",
        label: "Safety Margin",
      })
    }

    // Draw solved routes if available
    for (let si = 0; si < this.solvedRoutes.length; si++) {
      const route = this.solvedRoutes[si]
      const routeColor =
        si % 2 === 0 ? "rgba(0, 255, 0, 0.75)" : "rgba(255, 0, 255, 0.75)"
      for (let i = 0; i < route.route.length - 1; i++) {
        const pointA = route.route[i]
        const pointB = route.route[i + 1]

        graphics.lines!.push({
          points: [pointA, pointB],
          strokeColor: routeColor,
          strokeDash: pointA.z !== route.route[0].z ? [0.2, 0.2] : undefined,
          strokeWidth: route.traceThickness,
          label: `${route.connectionName} z=${pointA.z}`,
        })
      }

      // Draw vias in solved routes
      for (const via of route.vias) {
        graphics.circles!.push({
          center: via,
          radius: this.viaDiameter / 2,
          fill: "rgba(0, 0, 255, 0.8)",
          stroke: "black",
          label: "Solved Via",
        })
        graphics.circles!.push({
          center: via,
          radius: this.viaDiameter / 2 + this.obstacleMargin,
          fill: "rgba(0, 0, 255, 0.3)",
          stroke: "black",
          label: "Via Margin",
        })
      }
    }

    return graphics
  }

  /**
   * Get the solved routes
   */
  getSolvedRoutes(): HighDensityIntraNodeRoute[] {
    return this.solvedRoutes
  }
}
