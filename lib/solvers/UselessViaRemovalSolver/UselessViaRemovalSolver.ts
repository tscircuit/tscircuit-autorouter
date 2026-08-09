import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { GraphicsObject } from "graphics-debug"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { SegmentTree } from "lib/data-structures/SegmentTree"
import { Obstacle } from "lib/types"
import { HighDensityRoute } from "lib/types/high-density-types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"
import { getJumpersGraphics } from "lib/utils/getJumperGraphics"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { BaseSolver } from "../BaseSolver"
import { SingleRouteUselessViaRemovalSolver } from "./SingleRouteUselessViaRemovalSolver"
import { breakRouteIntoSections } from "./break-route-into-sections"
import { canEndpointConnectOnLayer } from "./can-endpoint-connect-on-layer"

export interface UselessViaRemovalSolverInput {
  unsimplifiedHdRoutes: HighDensityRoute[]
  /** Routed copper that participates in collision checks but is never changed. */
  otherHdRoutes?: ReadonlyArray<HighDensityRoute>
  obstacles: Obstacle[]
  colorMap: Record<string, string>
  layerCount: number
  connMap: ConnectivityMap
  outline?: Array<{ x: number; y: number }>
  geometryShortcutTraceMargin?: number
  geometryShortcutObstacleMargin?: number
  enableGeometryShortcuts?: boolean
  enableEndpointGeometryShortcuts?: boolean
  enableObstacleDetourShortcuts?: boolean
  onlyEndpointLayerChanges?: boolean
}

export class UselessViaRemovalSolver extends BaseSolver {
  override getSolverName(): string {
    return "UselessViaRemovalSolver"
  }

  unsimplifiedHdRoutes: HighDensityRoute[]
  optimizedHdRoutes: HighDensityRoute[]
  unprocessedRoutes: HighDensityRoute[]

  activeSubSolver?: SingleRouteUselessViaRemovalSolver | null | undefined = null

  obstacleSHI: ObstacleSpatialHashIndex | null = null
  hdRouteSHI: HighDensityRouteSpatialIndex | null = null

  constructor(private input: UselessViaRemovalSolverInput) {
    super()
    this.input = {
      ...input,
      obstacles: createObjectsWithZLayers(input.obstacles, input.layerCount),
    }
    this.MAX_ITERATIONS = 1e6
    this.unsimplifiedHdRoutes = input.unsimplifiedHdRoutes
    this.optimizedHdRoutes = []
    this.unprocessedRoutes = [...input.unsimplifiedHdRoutes]

    this.obstacleSHI = new ObstacleSpatialHashIndex(
      "flatbush",
      this.input.obstacles,
    )
    this.hdRouteSHI = new HighDensityRouteSpatialIndex([
      ...this.unsimplifiedHdRoutes,
      ...(input.otherHdRoutes ?? []),
    ])
  }

  private endpointCanChangeLayer(route: HighDensityRoute): boolean {
    const sections = breakRouteIntoSections(route)
    if (sections.length < 2) return false

    const firstPoint = sections[0].points[0]
    const lastSection = sections.at(-1)!
    const lastPoint = lastSection.points.at(-1)!
    return (
      canEndpointConnectOnLayer({
        endpointX: firstPoint.x,
        endpointY: firstPoint.y,
        targetZ: sections[1].z,
        obstacleSHI: this.obstacleSHI!,
        route,
        connMap: this.input.connMap,
      }) ||
      canEndpointConnectOnLayer({
        endpointX: lastPoint.x,
        endpointY: lastPoint.y,
        targetZ: sections.at(-2)!.z,
        obstacleSHI: this.obstacleSHI!,
        route,
        connMap: this.input.connMap,
      })
    )
  }

  _step() {
    if (this.activeSubSolver) {
      this.activeSubSolver.step()
      if (this.activeSubSolver.solved) {
        const optimizedRoute = this.activeSubSolver.getOptimizedHdRoute()
        this.hdRouteSHI!.removeRoute(optimizedRoute.connectionName)
        this.hdRouteSHI!.addRoute(optimizedRoute)
        this.optimizedHdRoutes.push(optimizedRoute)
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

    if (
      this.input.onlyEndpointLayerChanges &&
      !this.endpointCanChangeLayer(unprocessedRoute)
    ) {
      this.optimizedHdRoutes.push(unprocessedRoute)
      return
    }

    this.activeSubSolver = new SingleRouteUselessViaRemovalSolver({
      hdRouteSHI: this.hdRouteSHI!,
      obstacleSHI: this.obstacleSHI!,
      unsimplifiedRoute: unprocessedRoute,
      connMap: this.input.connMap,
      outline: this.input.outline,
      geometryShortcutTraceMargin: this.input.geometryShortcutTraceMargin,
      geometryShortcutObstacleMargin: this.input.geometryShortcutObstacleMargin,
      enableGeometryShortcuts: this.input.enableGeometryShortcuts,
      enableEndpointGeometryShortcuts:
        this.input.enableEndpointGeometryShortcuts,
      enableObstacleDetourShortcuts: this.input.enableObstacleDetourShortcuts,
      onlyEndpointLayerChanges: this.input.onlyEndpointLayerChanges,
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
      const isOnLayer0 = obstacle.__zLayers?.includes(0)
      const isOnLayer1 = obstacle.__zLayers?.includes(1)

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
        label: `Obstacle (Z: ${obstacle.__zLayers?.join(", ")})`,
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
