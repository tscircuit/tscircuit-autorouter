import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types"
import type { GraphicsObject } from "graphics-debug"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolverAdapter } from "lib/bindings/trace-simplification/TraceSimplificationSolverAdapter"

interface Point { x: number; y: number; z: number }
export type SingleSimplifiedPathParams = {
  inputRoute: HighDensityIntraNodeRoute; otherHdRoutes: HighDensityIntraNodeRoute[]; obstacles: Obstacle[];
  connMap: ConnectivityMap; colorMap: Record<string, string>; outline?: Array<{ x: number; y: number }>;
  minBoardEdgeClearance?: number;
}
export class SingleSimplifiedPathSolver extends TraceSimplificationSolverAdapter {
  static override solverKind = "path-base"
  static override stateFields = ["newRoute", "newVias", "headIndex", "tailIndex", "inputRoute", "otherHdRoutes", "obstacles", "connMap", "colorMap", "outline", "minBoardEdgeClearance"]
  declare newRoute: HighDensityIntraNodeRoute["route"]
  declare newVias: HighDensityIntraNodeRoute["vias"]
  declare headIndex: number
  declare tailIndex: number
  declare inputRoute: HighDensityIntraNodeRoute
  declare otherHdRoutes: HighDensityIntraNodeRoute[]
  declare obstacles: Obstacle[]
  declare connMap: ConnectivityMap
  declare colorMap: Record<string, string>
  declare outline?: Array<{ x: number; y: number }>
  declare minBoardEdgeClearance: number
  constructor(params: SingleSimplifiedPathParams) { super(params) }
  override getSolverName(): string { return "SingleSimplifiedPathSolver" }
  override getConstructorParams(): Omit<SingleSimplifiedPathParams, "connMap"> & { connMap: ConnectivityMap["netMap"] } {
    return { inputRoute: this.inputRoute, otherHdRoutes: this.otherHdRoutes, obstacles: this.obstacles, connMap: this.connMap.netMap, colorMap: this.colorMap, outline: this.outline, minBoardEdgeClearance: this.minBoardEdgeClearance }
  }
  get simplifiedRoute(): HighDensityIntraNodeRoute { return this.output() }
  isValidPath(pointsInRoute: Point[]): boolean { return this.invoke("isValidPath", [pointsInRoute]) }
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
TraceSimplificationSolverAdapter.register("path-base", SingleSimplifiedPathSolver)
