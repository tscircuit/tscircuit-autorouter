import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { SegmentTree } from "lib/data-structures/SegmentTree"
import { BaseSolver } from "../BaseSolver"
import { HighDensityRoute } from "lib/types/high-density-types"
import { Obstacle } from "lib/types"
import { GraphicsObject } from "graphics-debug"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { SingleRouteUselessViaRemovalSolver } from "./SingleRouteUselessViaRemovalSolver"
import { getJumpersGraphics } from "lib/utils/getJumperGraphics"

export interface UselessViaRemovalSolverInput {
  unsimplifiedHdRoutes: HighDensityRoute[]
  obstacles: Obstacle[]
  colorMap: Record<string, string>
  layerCount: number
}

export class UselessViaRemovalSolver extends BaseSolver {
  unsimplifiedHdRoutes: HighDensityRoute[]
  optimizedHdRoutes: HighDensityRoute[]
  unprocessedRoutes: HighDensityRoute[]

  activeSubSolver?: SingleRouteUselessViaRemovalSolver | null | undefined = null

  obstacleSHI: ObstacleSpatialHashIndex | null = null
  hdRouteSHI: HighDensityRouteSpatialIndex | null = null

  constructor(private input: UselessViaRemovalSolverInput) {
    super()
    this.MAX_ITERATIONS = 1e6
    this.unsimplifiedHdRoutes = input.unsimplifiedHdRoutes
    this.optimizedHdRoutes = []
    this.unprocessedRoutes = [...input.unsimplifiedHdRoutes]

    this.obstacleSHI = new ObstacleSpatialHashIndex("flatbush", input.obstacles)
    this.hdRouteSHI = new HighDensityRouteSpatialIndex(
      this.unsimplifiedHdRoutes,
    )
  }

  _step() {
    if (this.activeSubSolver) {
      this.activeSubSolver.step()
      if (this.activeSubSolver.solved) {
        this.optimizedHdRoutes.push(this.activeSubSolver.getOptimizedHdRoute())
        this.activeSubSolver = null
      } else if (this.activeSubSolver.failed || this.activeSubSolver.error) {
        this.error = this.activeSubSolver.error
        this.failed = true
      }
      return
    }

    const unprocessedRoute = this.unprocessedRoutes.shift()
    if (!unprocessedRoute) {
      this.solved = true
      return
    }

    this.activeSubSolver = new SingleRouteUselessViaRemovalSolver({
      hdRouteSHI: this.hdRouteSHI!,
      obstacleSHI: this.obstacleSHI!,
      unsimplifiedRoute: unprocessedRoute,
    })
  }

  getOptimizedHdRoutes(): HighDensityRoute[] | null {
    return this.optimizedHdRoutes
  }

  visualize(): GraphicsObject {
    const visualization: GraphicsObject &
      Pick<Required<GraphicsObject>, "points" | "lines" | "rects" | "circles"> =
      {
        lines: [],
        points: [],
        rects: [],
        circles: [],
        coordinateSystem: "cartesian",
        title: "Useless Via Removal Solver",
      }

    // Visualize obstacles
    for (const obstacle of this.input.obstacles) {
      let fillColor = "rgba(128, 128, 128, 0.2)" // Default faded gray
      const strokeColor = "rgba(128, 128, 128, 0.5)"
      const isOnLayer0 = obstacle.zLayers?.includes(0)
      const isOnLayer1 = obstacle.zLayers?.includes(1)

      if (isOnLayer0 && isOnLayer1) {
        fillColor = "rgba(128, 0, 128, 0.2)" // Faded purple for both layers
      } else if (isOnLayer0) {
        fillColor = "rgba(255, 0, 0, 0.2)" // Faded red for layer 0
      } else if (isOnLayer1) {
        fillColor = "rgba(0, 0, 255, 0.2)" // Faded blue for layer 1
      }

      visualization.rects.push({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        fill: fillColor,
        label: `Obstacle (Z: ${obstacle.zLayers?.join(", ")})`,
      })
    }

    // Display each optimized route
    for (const route of this.optimizedHdRoutes) {
      // Skip routes with no points
      if (route.route.length === 0) continue

      const color = this.input.colorMap[route.connectionName] || "#888888"

      // Add lines connecting route points on the same layer
      for (let i = 0; i < route.route.length - 1; i++) {
        const current = route.route[i]
        const next = route.route[i + 1]

        // Only draw segments that are on the same layer
        if (current.z === next.z) {
          visualization.lines.push({
            points: [
              { x: current.x, y: current.y },
              { x: next.x, y: next.y },
            ],
            strokeColor: current.z === 0 ? "red" : "blue",
            strokeWidth: route.traceThickness,
            label: `${route.connectionName} (z=${current.z})`,
          })
        }
      }

      // Add circles for vias
      for (const via of route.vias) {
        visualization.circles.push({
          center: { x: via.x, y: via.y },
          radius: route.viaDiameter / 2,
          fill: "rgba(255, 0, 255, 0.5)",
          label: `${route.connectionName} via`,
        })
      }

      // Draw jumpers
      if (route.jumpers && route.jumpers.length > 0) {
        const jumperGraphics = getJumpersGraphics(route.jumpers, {
          color,
          label: route.connectionName,
        })
        visualization.rects.push(...(jumperGraphics.rects ?? []))
        visualization.lines.push(...(jumperGraphics.lines ?? []))
      }
    }

    if (this.activeSubSolver) {
      visualization.lines.push(
        ...(this.activeSubSolver.visualize().lines ?? []),
      )
    }

    return visualization
  }
}
