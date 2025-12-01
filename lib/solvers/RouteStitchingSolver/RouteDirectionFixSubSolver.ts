import { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { BaseSolver } from "../BaseSolver"
import { GraphicsObject } from "graphics-debug"

/**
 * RouteDirectionFixSubSolver
 *
 * Optimizes route directions by comparing pad-to-endpoint distances.
 * Reverses routes when cross-connections provide better alignment.
 */
export class RouteDirectionFixSubSolver extends BaseSolver {
  private routes: HighDensityIntraNodeRoute[]
  private reversedRoutes: Set<string> = new Set()
  private currentIndex: number = 0
  private colorMap: Record<string, string>

  constructor(
    routes: HighDensityIntraNodeRoute[],
    colorMap?: Record<string, string>,
  ) {
    super()

    if (!routes || !Array.isArray(routes)) {
      throw new Error(
        "RouteDirectionFixSubSolver requires a valid routes array",
      )
    }

    if (routes.length === 0) {
      throw new Error(
        "RouteDirectionFixSubSolver cannot process empty routes array",
      )
    }

    this.routes = routes
    this.colorMap = colorMap ?? {}
    this.MAX_ITERATIONS = routes.length + 10
  }

  getConstructorParams() {
    return this.routes
  }

  _step() {
    if (this.currentIndex >= this.routes.length) {
      this.solved = true
      return
    }

    const route = this.routes[this.currentIndex]

    // Validate route data integrity
    if (!route) {
      this.failed = true
      this.error = `Route at index ${this.currentIndex} is null or undefined`
      return
    }

    if (!route.route || !Array.isArray(route.route)) {
      this.failed = true
      this.error = `Route ${route.connectionName || "unnamed"} has invalid route data`
      return
    }

    if (route.route.length >= 4) {
      try {
        const pad1 = route.route[0]
        const pad2 = route.route[route.route.length - 1]
        const point1 = route.route[1]
        const point2 = route.route[route.route.length - 2]

        // Validate coordinate data
        if (!pad1 || !pad2 || !point1 || !point2) {
          throw new Error("Route contains null/undefined points")
        }

        if (
          typeof pad1.x !== "number" ||
          typeof pad1.y !== "number" ||
          typeof pad2.x !== "number" ||
          typeof pad2.y !== "number" ||
          typeof point1.x !== "number" ||
          typeof point1.y !== "number" ||
          typeof point2.x !== "number" ||
          typeof point2.y !== "number"
        ) {
          throw new Error("Route contains invalid coordinate data")
        }

        // Use squared distances for performance optimization (comparison remains valid)
        const currentDirectionDistanceSquared =
          (pad1.x - point1.x) ** 2 +
          (pad1.y - point1.y) ** 2 +
          (pad2.x - point2.x) ** 2 +
          (pad2.y - point2.y) ** 2
        const alternativeDirectionDistanceSquared =
          (pad1.x - point2.x) ** 2 +
          (pad1.y - point2.y) ** 2 +
          (pad2.x - point1.x) ** 2 +
          (pad2.y - point1.y) ** 2

        if (
          currentDirectionDistanceSquared > alternativeDirectionDistanceSquared
        ) {
          const mid = route.route.slice(1, route.route.length - 1)
          route.route = [
            route.route[0],
            ...mid.reverse(),
            route.route[route.route.length - 1],
          ]
          this.reversedRoutes.add(route.connectionName)
        }
      } catch (error) {
        this.failed = true
        this.error = `Failed to process route ${route.connectionName || "unnamed"}: ${error}`
        return
      }
    }

    this.currentIndex++
    this.progress = this.currentIndex / this.routes.length
  }

  /**
   * Gets the processed routes with optimized directions
   */
  getProcessedRoutes(): HighDensityIntraNodeRoute[] {
    return this.routes
  }

  /**
   * Visualization showing route direction optimization progress
   */
  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      points: [],
      lines: [],
      rects: [],
    }

    for (let i = 0; i < this.routes.length; i++) {
      const route = this.routes[i]
      if (!route.route || route.route.length < 2) continue

      const isProcessed = i < this.currentIndex
      const wasReversed = this.reversedRoutes.has(route.connectionName)

      // Use colorMap for consistent colors with other solvers, fallback to status colors
      const baseColor = this.colorMap[route.connectionName]
      let routeColor = baseColor ?? "gray"

      if (isProcessed && !baseColor) {
        routeColor = wasReversed ? "orange" : "blue"
      } else if (i === this.currentIndex && !baseColor) {
        routeColor = "yellow"
      }

      const routePoints = route.route.map((point) => ({
        x: point.x,
        y: point.y,
      }))
      graphics.lines?.push({
        points: routePoints,
        strokeColor: routeColor,
      })

      if (wasReversed && isProcessed) {
        const start = route.route[0]
        const end = route.route[route.route.length - 1]
        graphics.rects?.push({
          center: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
          width: 0.5,
          height: 0.5,
          fill: "yellow",
          label: `${route.connectionName}_REVERSED`,
        })
      }

      if (i === this.currentIndex && !this.solved) {
        const start = route.route[0]
        graphics.points?.push({
          x: start.x,
          y: start.y,
          color: "red",
          label: `PROCESSING_${route.connectionName}`,
        })
      }
    }

    return graphics
  }
}
