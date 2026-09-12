import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { TraceSimplificationSolverAdapter } from "../../bindings/trace-simplification/TraceSimplificationSolverAdapter"
import {
  HighDensityIntraNodeRoute,
  HighDensityRoute,
} from "lib/types/high-density-types"
import { Obstacle } from "lib/types"
import { GraphicsObject } from "graphics-debug"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getJumpersGraphics } from "lib/utils/getJumperGraphics"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"

export interface SameNetViaMergerSolverInput {
  inputHdRoutes: HighDensityRoute[]
  /** Routed copper that participates in collision checks but is never changed. */
  otherHdRoutes?: ReadonlyArray<HighDensityRoute>
  /** Explicit connection metadata for routes whose names are not in connMap. */
  netByConnectionName?: ReadonlyMap<string, string>
  obstacles: Obstacle[]
  colorMap: Record<string, string>
  layerCount: number
  connMap: ConnectivityMap
  outline?: Array<{ x: number; y: number }>
  /** Prevent transition clusters that touch a route endpoint from moving. */
  preserveRouteEndpoints?: boolean
}

type Via = {
  x: number
  y: number
  diameter: number
  net: string
  routeIndex: number
  layers: number[]
  mutable: boolean
}

export class SameNetViaMergerSolver extends TraceSimplificationSolverAdapter {
  static solverKind = "via-merger"
  static stateFields = ["inputHdRoutes", "mergedViaHdRoutes", "unprocessedRoutes", "vias", "offendingVias", "currentViaRoutes", "connMap", "colorMap", "outline", "obstacles", "viasByNet", "netByConnectionName", "obstacleSHI", "hdRouteSHI"]

  declare inputHdRoutes: HighDensityRoute[]
  declare mergedViaHdRoutes: HighDensityRoute[]
  declare unprocessedRoutes: HighDensityRoute[]
  declare vias: Via[]
  declare offendingVias: [Via, Via][]
  declare currentViaRoutes: HighDensityIntraNodeRoute[]
  declare connMap: ConnectivityMap
  declare colorMap: Record<string, string>
  declare outline: Array<{ x: number; y: number }> | undefined
  declare obstacles: Obstacle[]
  declare viasByNet: Map<string, Via[]>
  declare netByConnectionName: ReadonlyMap<string, string> | undefined
  declare obstacleSHI: ObstacleSpatialHashIndex
  declare hdRouteSHI: HighDensityRouteSpatialIndex
  private input: SameNetViaMergerSolverInput

  constructor(input: SameNetViaMergerSolverInput) {
    super(input)
    this.input = { ...input, obstacles: createObjectsWithZLayers(input.obstacles, input.layerCount) }
  }

  override getSolverName(): string { return "SameNetViaMergerSolver" }
  private createHdRouteSpatialIndex(): HighDensityRouteSpatialIndex {
    return new HighDensityRouteSpatialIndex([
      ...this.mergedViaHdRoutes,
      ...(this.input.otherHdRoutes ?? []),
    ])
  }
  private rebuildVias(): void { this.invoke("rebuildVias", []) }
  private getViaKey(via: Via): string { return this.invoke("getViaKey", [via]) as string }
  private dedupeRouteVias(route: HighDensityRoute): void { this.invoke("dedupeRouteVias", [route]) }
  private getOffendingViaGroupsBatch(): Array<{ keep: Via; remove: Via[] }> {
    return this.invoke("getOffendingViaGroupsBatch", []) as Array<{ keep: Via; remove: Via[] }>
  }
  private moveViaTo(viaToRemove: Via, viaKeep: Via, rebuildVias = true): void {
    this.invoke("moveViaTo", [viaToRemove, viaKeep, rebuildVias])
  }
  getMergedViaHdRoutes(): HighDensityRoute[] | null {
    return this.invoke("getMergedViaHdRoutes", []) as HighDensityRoute[]
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
        title: "Same Net Via Merger Solver",
      }

    // Visualize obstacles
    for (const obstacle of this.input.obstacles) {
      if (!obstacle.__zLayers) {
        throw new Error(
          `SameNetViaMergerSolver found obstacle without zLayers while visualizing`,
        )
      }

      let fillColor = "rgba(128, 128, 128, 0.2)" // Default faded gray
      const strokeColor = "rgba(128, 128, 128, 0.5)"
      const isOnLayer0 = obstacle.__zLayers.includes(0)
      const isOnLayer1 = obstacle.__zLayers.includes(1)

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
    for (const route of this.mergedViaHdRoutes) {
      // Skip routes with no points
      if (route.route.length === 0) continue

      const color = this.input.colorMap[route.connectionName]
      if (!color) {
        throw new Error(
          `SameNetViaMergerSolver could not find color for route "${route.connectionName}"`,
        )
      }

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
            strokeColor:
              current.z === 0 ? "rgba(255, 0, 0, 0.5)" : "rgba(0, 0, 255, 0.5)",
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
        if (!jumperGraphics.rects || !jumperGraphics.lines) {
          throw new Error(
            `SameNetViaMergerSolver expected jumper graphics for route "${route.connectionName}"`,
          )
        }
        visualization.rects.push(...jumperGraphics.rects)
        visualization.lines.push(...jumperGraphics.lines)
      }
    }

    return visualization
  }
}

TraceSimplificationSolverAdapter.register("via-merger", SameNetViaMergerSolver)
