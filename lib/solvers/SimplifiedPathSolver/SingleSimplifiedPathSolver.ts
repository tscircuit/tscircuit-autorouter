import { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { BaseSolver } from "../BaseSolver"
import { Obstacle } from "lib/types"
import { calculate45DegreePaths } from "lib/utils/calculate45DegreePaths"
import { GraphicsObject } from "graphics-debug"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"

interface Point {
  x: number
  y: number
  z: number
}

export class SingleSimplifiedPathSolver extends BaseSolver {
  override getSolverName(): string {
    return "SingleSimplifiedPathSolver"
  }

  newRoute: HighDensityIntraNodeRoute["route"]
  newVias: HighDensityIntraNodeRoute["vias"]

  headIndex = 0
  tailIndex = 0

  inputRoute: HighDensityIntraNodeRoute
  otherHdRoutes: HighDensityIntraNodeRoute[]
  obstacles: Obstacle[]
  connMap: ConnectivityMap
  colorMap: Record<string, string>
  outline?: Array<{ x: number; y: number }>

  constructor(params: {
    inputRoute: HighDensityIntraNodeRoute
    otherHdRoutes: HighDensityIntraNodeRoute[]
    obstacles: Obstacle[]
    connMap: ConnectivityMap
    colorMap: Record<string, string>
    outline?: Array<{ x: number; y: number }>
  }) {
    super()

    this.inputRoute = params.inputRoute
    this.otherHdRoutes = params.otherHdRoutes
    this.obstacles = params.obstacles
    this.connMap = params.connMap
    this.colorMap = params.colorMap
    this.outline = params.outline

    this.newRoute = [this.inputRoute.route[0]]
    this.newVias = []
  }

  getConstructorParams() {
    return {
      inputRoute: this.inputRoute,
      otherHdRoutes: this.otherHdRoutes,
      obstacles: this.obstacles,
      connMap: this.connMap.netMap,
      colorMap: this.colorMap,
      outline: this.outline,
    }
  }

  get simplifiedRoute(): HighDensityIntraNodeRoute {
    return {
      connectionName: this.inputRoute.connectionName,
      rootConnectionName: this.inputRoute.rootConnectionName,
      traceThickness: this.inputRoute.traceThickness,
      viaDiameter: this.inputRoute.viaDiameter,
      route: this.newRoute,
      vias: this.newVias,
      // Preserve jumpers from original route
      jumpers: this.inputRoute.jumpers,
    }
  }

  isValidPath(pointsInRoute: Point[]): boolean {
    // check that the segments don't intersect with any obstacles or other
    // routes or vias
    throw new Error("Not implemented")
  }

  _step() {
    // Each iteration, we're going to increase the head and make sure that
    // there's a compatible simplified path from the tail to the head
    // If there isn't a compatible simplified path, we add a segment to the new
    // route from [tail, tail + (head - tail) / 2] then start our next iteration
    // at tail = tail + Math.ceil((head - tail) / 2)
    // If there is a Z change between the tail and the head, we stop the
    // simplification for that segment (add to newRoute and newVias, set tail to
    // head)
    throw new Error("Not implemented")
  }

  getVisualsForNewRouteAndObstacles() {
    const graphics: GraphicsObject &
      Pick<Required<GraphicsObject>, "points" | "lines" | "rects" | "circles"> =
      {
        lines: [],
        points: [],
        circles: [],
        rects: [],
        coordinateSystem: "cartesian",
        title: "Simplified Path Solver",
      }

    // Visualize the original route in red
    for (let i = 0; i < this.inputRoute.route.length - 1; i++) {
      graphics.lines.push({
        points: [
          { x: this.inputRoute.route[i].x, y: this.inputRoute.route[i].y },
          {
            x: this.inputRoute.route[i + 1].x,
            y: this.inputRoute.route[i + 1].y,
          },
        ],
        strokeColor: "rgba(255, 0, 0, 0.8)",
        strokeDash: this.inputRoute.route[i].z === 1 ? "5, 5" : undefined,
        layer: `z${this.inputRoute.route[i].z.toString()}`,
      })
    }

    // Visualize the simplified route in green
    for (let i = 0; i < this.newRoute.length; i++) {
      if (i < this.newRoute.length - 1) {
        graphics.lines.push({
          points: [
            { x: this.newRoute[i].x, y: this.newRoute[i].y },
            { x: this.newRoute[i + 1].x, y: this.newRoute[i + 1].y },
          ],
          strokeWidth: 0.15,
          strokeColor: "rgba(0, 255, 0, 0.8)",
          strokeDash: this.newRoute[i].z === 1 ? [0.4, 0.4] : undefined,
          layer: `z${this.newRoute[i].z.toString()}`,
        })
      }
      graphics.points.push({
        x: this.newRoute[i].x,
        y: this.newRoute[i].y,
        color: "rgba(0, 255, 0, 0.8)",
        label: `z: ${this.newRoute[i].z}`,
        layer: `z${this.newRoute[i].z.toString()}`,
      })
    }

    // // Visualize vias
    for (const via of this.newVias) {
      graphics.circles.push({
        center: via,
        radius: this.inputRoute.viaDiameter / 2,
        fill: "rgba(0, 0, 255, 0.5)",
      })
    }

    // Visualize obstacles
    for (const obstacle of this.obstacles) {
      graphics.rects.push({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        fill: obstacle.layers?.includes("top")
          ? "rgba(255, 0, 0, 0.3)"
          : obstacle.layers?.includes("bottom")
            ? "rgba(0, 0, 255, 0.3)"
            : "rgba(128, 128, 128, 0.3)",
      })
    }

    // Visualize other routes as obstacles (in purple)
    for (const route of this.otherHdRoutes) {
      for (let i = 0; i < route.route.length - 1; i++) {
        graphics.lines.push({
          points: [
            { x: route.route[i].x, y: route.route[i].y },
            { x: route.route[i + 1].x, y: route.route[i + 1].y },
          ],
          strokeWidth: 0.15,
          strokeColor:
            route.route[i].z === 0
              ? "rgba(255, 0, 255, 0.5)" // top layer (purple)
              : route.route[i].z === 1
                ? "rgba(128, 0, 128, 0.5)" // inner layer (darker purple)
                : "rgba(0, 0, 255, 0.5)", // bottom layer (blue)
          layer: `z${route.route[i].z.toString()}`,
        })
      }
    }

    if ("filteredObstaclePathSegments" in this) {
      const filteredObstaclePathSegments = this
        .filteredObstaclePathSegments as Array<[Point, Point]>
      for (const [start, end] of filteredObstaclePathSegments) {
        graphics.lines.push({
          points: [start, end],
        })
      }
    }

    return graphics
  }
}
