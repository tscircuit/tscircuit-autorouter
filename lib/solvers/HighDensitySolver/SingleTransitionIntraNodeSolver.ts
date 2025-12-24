import { BaseSolver } from "lib/solvers/BaseSolver"
import {
  NodeWithPortPoints,
  HighDensityIntraNodeRoute,
} from "lib/types/high-density-types"
import { clamp } from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"

type Point = { x: number; y: number; z?: number }
type Route = {
  A: Point
  B: Point
  connectionName: string
}

export class SingleTransitionIntraNodeSolver extends BaseSolver {
  nodeWithPortPoints: NodeWithPortPoints
  routes: Route[]
  viaDiameter: number
  traceThickness: number
  obstacleMargin: number
  solvedRoutes: HighDensityIntraNodeRoute[] = []
  bounds: { minX: number; maxX: number; minY: number; maxY: number }

  constructor(params: {
    nodeWithPortPoints: NodeWithPortPoints
    viaDiameter?: number
    traceThickness?: number
    obstacleMargin?: number
  }) {
    super()

    this.nodeWithPortPoints = params.nodeWithPortPoints
    this.viaDiameter = params?.viaDiameter ?? 0.6
    this.traceThickness = params?.traceThickness ?? 0.15
    this.obstacleMargin = params?.obstacleMargin ?? 0.1

    this.routes = this.extractRoutesFromNode()
    this.bounds = this.calculateBounds()

    if (this.routes.length !== 1) {
      this.failed = true
      this.error = `Expected 1 route, but got ${this.routes.length}`
      return
    }

    const route = this.routes[0]
    if (route.A.z === undefined || route.B.z === undefined) {
      this.failed = true
      this.error = `Route points should have predefined z values`
      return
    }
    if (route.A.z === route.B.z) {
      this.failed = true
      this.error = "Only one route provided, but it has no transition"
      return
    }

    const margin = this.viaDiameter / 2 + this.obstacleMargin

    const viaPosition = {
      x: clamp(
        (route.A.x + route.B.x) / 2,
        this.bounds.minX + margin,
        this.bounds.maxX - margin,
      ),
      y: clamp(
        (route.A.y + route.B.y) / 2,
        this.bounds.minY + margin,
        this.bounds.maxY - margin,
      ),
    }
    this.solvedRoutes.push(
      this.createTransitionRoute(
        route.A,
        route.B,
        viaPosition,
        route.connectionName,
      ),
    )
    this.solved = true
  }

  private extractRoutesFromNode(): Route[] {
    const routes: Route[] = []
    const connectedPorts = this.nodeWithPortPoints.portPoints!
    const connectionGroups = new Map<string, Point[]>()

    for (const connectedPort of connectedPorts) {
      const { connectionName } = connectedPort
      if (!connectionGroups.has(connectionName)) {
        connectionGroups.set(connectionName, [])
      }
      connectionGroups.get(connectionName)!.push(connectedPort)
    }

    for (const [connectionName, points] of connectionGroups.entries()) {
      if (points.length === 2) {
        routes.push({
          A: { ...points[0] },
          B: { ...points[1] },
          connectionName,
        })
      }
    }
    return routes
  }

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

  private createTransitionRoute(
    start: Point,
    end: Point,
    via: Point,
    connectionName: string,
  ): HighDensityIntraNodeRoute {
    const route = [
      { x: start.x, y: start.y, z: start.z! },
      { x: via.x, y: via.y, z: start.z! },
      { x: via.x, y: via.y, z: end.z! },
      { x: end.x, y: end.y, z: end.z! },
    ]

    return {
      connectionName,
      route,
      traceThickness: this.traceThickness,
      viaDiameter: this.viaDiameter,
      vias: [via],
    }
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

    if (this.routes.length > 0) {
      for (const route of this.routes) {
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
        graphics.lines!.push({
          points: [route.A, route.B],
          strokeColor: "rgba(255, 0, 0, 0.5)",
          label: `${route.connectionName} direct`,
        })
      }
    }

    for (let si = 0; si < this.solvedRoutes.length; si++) {
      const route = this.solvedRoutes[si]
      const routeColor = "rgba(0, 255, 0, 0.75)"
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
}
