import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { BaseSolver } from "../BaseSolver"
import {
  HighDensityIntraNodeRoute,
  HighDensityRoute,
} from "lib/types/high-density-types"
import { Obstacle } from "lib/types"
import { GraphicsObject } from "graphics-debug"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getJumpersGraphics } from "lib/utils/getJumperGraphics"

export interface SameNetViaMergerSolverInput {
  inputHdRoutes: HighDensityRoute[]
  obstacles: Obstacle[]
  colorMap: Record<string, string>
  layerCount: number
  connMap?: ConnectivityMap
  outline?: Array<{ x: number; y: number }>
}

type Via = {
  x: number
  y: number
  diameter: number
  net: string
  routeIndex: number
  layers: number[]
}

export class SameNetViaMergerSolver extends BaseSolver {
  inputHdRoutes: HighDensityRoute[]
  mergedViaHdRoutes: HighDensityRoute[]
  unprocessedRoutes: HighDensityRoute[]
  vias: Via[]
  offendingVias: [Via, Via][]
  currentViaRoutes: HighDensityIntraNodeRoute[] = []
  connMap?: ConnectivityMap
  colorMap: Record<string, string>
  outline?: Array<{ x: number; y: number }>
  obstacles: Obstacle[]
  viasByNet: Map<string, Via[]>

  obstacleSHI: ObstacleSpatialHashIndex | null = null
  hdRouteSHI: HighDensityRouteSpatialIndex | null = null

  constructor(private input: SameNetViaMergerSolverInput) {
    super()
    this.MAX_ITERATIONS = 1e6
    this.inputHdRoutes = input.inputHdRoutes
    this.mergedViaHdRoutes = structuredClone(this.inputHdRoutes)
    this.unprocessedRoutes = [...input.inputHdRoutes]
    this.colorMap = input.colorMap
    this.outline = input.outline
    this.obstacles = input.obstacles

    this.obstacleSHI = new ObstacleSpatialHashIndex("flatbush", input.obstacles)
    this.hdRouteSHI = new HighDensityRouteSpatialIndex(this.inputHdRoutes)
    this.vias = []
    this.offendingVias = []
    this.connMap = input.connMap

    this.viasByNet = new Map<string, Via[]>()

    this.rebuildVias()
  }

  private rebuildVias() {
    this.vias = []
    this.viasByNet = new Map<string, Via[]>()

    for (let i = 0; i < this.mergedViaHdRoutes.length; i++) {
      const route = this.mergedViaHdRoutes[i]
      for (let j = 0; j < route.vias.length; j++) {
        const viaPoint = route.vias[j]
        const via: Via = {
          x: viaPoint.x,
          y: viaPoint.y,
          diameter: route.viaDiameter,
          net: this.connMap?.idToNetMap[route.connectionName] ?? "",
          layers: [...new Set(route.route.map((p) => p.z))],
          routeIndex: i,
        }
        this.vias.push(via)
        const list = this.viasByNet.get(via.net)
        if (list) list.push(via)
        else this.viasByNet.set(via.net, [via])
      }
    }
  }

  private findNextOffendingPair(): [Via, Via] | null {
    for (let i = 0; i < this.vias.length - 1; i++) {
      const firstVia = this.vias[i]
      const viasInNet = this.viasByNet.get(firstVia.net)
      if (!viasInNet) continue

      const firstIndexInNet = viasInNet.indexOf(firstVia)
      const startJ = firstIndexInNet >= 0 ? firstIndexInNet + 1 : 0

      for (let j = startJ; j < viasInNet.length; j++) {
        const secondVia = viasInNet[j]
        const dx = firstVia.x - secondVia.x
        const dy = firstVia.y - secondVia.y
        const squaredDistance = dx * dx + dy * dy
        const maxDistance = firstVia.diameter / 2 + secondVia.diameter / 2
        const maxSquaredDistance = maxDistance * maxDistance

        if (squaredDistance <= maxSquaredDistance && squaredDistance !== 0) {
          return [firstVia, secondVia]
        }
      }
    }
    return null
  }

  private handleOffendingPair(v1: Via, v2: Via) {
    const viaToRemove = v1.layers.length < v2.layers.length ? v1 : v2
    const viaKeep = viaToRemove === v1 ? v2 : v1

    const route = this.mergedViaHdRoutes[viaToRemove.routeIndex].route

    for (let i = 0; i < viaToRemove.layers.length; i++) {
      for (let j = route.length - 1; j >= 1; j--) {
        const prev = route[j - 1]
        const curr = route[j]

        if (curr.x === viaToRemove.x && curr.y === viaToRemove.y) {
          route.splice(j, 0, { x: viaKeep.x, y: viaKeep.y, z: curr.z })
          route.splice(j, 0, { x: viaKeep.x, y: viaKeep.y, z: prev.z })

          const r = this.mergedViaHdRoutes[viaToRemove.routeIndex]
          r.vias = r.vias.map((vx) =>
            vx.x === viaToRemove.x && vx.y === viaToRemove.y
              ? { x: viaKeep.x, y: viaKeep.y }
              : vx,
          )

          this.rebuildVias()
          return
        }
      }
    }

    this.rebuildVias()
  }

  _step() {
    const pair = this.findNextOffendingPair()

    if (!pair) {
      this.solved = true
      return
    }

    this.handleOffendingPair(pair[0], pair[1])
  }

  getMergedViaHdRoutes(): HighDensityRoute[] | null {
    return this.mergedViaHdRoutes
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
    for (const route of this.mergedViaHdRoutes) {
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
