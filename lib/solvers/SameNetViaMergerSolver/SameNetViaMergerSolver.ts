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
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"

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
  override getSolverName(): string {
    return "SameNetViaMergerSolver"
  }

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
    this.input = {
      ...input,
      obstacles: createObjectsWithZLayers(input.obstacles, input.layerCount),
    }
    this.MAX_ITERATIONS = 1e6
    this.inputHdRoutes = this.input.inputHdRoutes
    this.mergedViaHdRoutes = structuredClone(this.inputHdRoutes)
    this.unprocessedRoutes = [...this.input.inputHdRoutes]
    this.colorMap = this.input.colorMap
    this.outline = this.input.outline
    this.obstacles = this.input.obstacles

    this.obstacleSHI = new ObstacleSpatialHashIndex(
      "flatbush",
      this.input.obstacles,
    )
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

  private getViaKey(via: Via) {
    return [via.routeIndex, via.x, via.y, via.layers.join(","), via.net].join(
      ":",
    )
  }

  private dedupeRouteVias(route: HighDensityRoute) {
    const seenViaLocations = new Set<string>()
    route.vias = route.vias.filter((via) => {
      const key = `${via.x}:${via.y}`
      if (seenViaLocations.has(key)) return false
      seenViaLocations.add(key)
      return true
    })
  }

  private getOverlappingViaComponents(): Via[][] {
    const components: Via[][] = []

    for (const viasInNet of this.viasByNet.values()) {
      if (viasInNet.length < 2) continue

      const maxDiameter = Math.max(
        1e-6,
        ...viasInNet.map((via) => via.diameter),
      )
      const cellSize = maxDiameter
      const buckets = new Map<string, number[]>()
      const parents = viasInNet.map((_, index) => index)
      const componentHasOverlap = new Set<number>()

      const findRoot = (index: number): number => {
        let root = index
        while (parents[root] !== root) {
          root = parents[root]
        }
        while (parents[index] !== index) {
          const next = parents[index]
          parents[index] = root
          index = next
        }
        return root
      }

      const union = (a: number, b: number) => {
        const rootA = findRoot(a)
        const rootB = findRoot(b)
        if (rootA === rootB) return
        parents[rootB] = rootA
      }

      for (let viaIndex = 0; viaIndex < viasInNet.length; viaIndex++) {
        const via = viasInNet[viaIndex]
        const cellX = Math.floor(via.x / cellSize)
        const cellY = Math.floor(via.y / cellSize)

        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const bucket = buckets.get(`${cellX + dx}:${cellY + dy}`)
            if (!bucket) continue

            for (const candidateIndex of bucket) {
              const candidate = viasInNet[candidateIndex]
              const pairDx = via.x - candidate.x
              const pairDy = via.y - candidate.y
              const squaredDistance = pairDx * pairDx + pairDy * pairDy
              const maxDistance = via.diameter / 2 + candidate.diameter / 2
              const maxSquaredDistance = maxDistance * maxDistance

              if (squaredDistance <= maxSquaredDistance && squaredDistance) {
                union(candidateIndex, viaIndex)
                componentHasOverlap.add(candidateIndex)
                componentHasOverlap.add(viaIndex)
              }
            }
          }
        }

        const bucketKey = `${cellX}:${cellY}`
        const bucket = buckets.get(bucketKey)
        if (bucket) bucket.push(viaIndex)
        else buckets.set(bucketKey, [viaIndex])
      }

      const componentIndicesByRoot = new Map<number, number[]>()
      for (let viaIndex = 0; viaIndex < viasInNet.length; viaIndex++) {
        if (!componentHasOverlap.has(viaIndex)) continue
        const root = findRoot(viaIndex)
        const component = componentIndicesByRoot.get(root)
        if (component) component.push(viaIndex)
        else componentIndicesByRoot.set(root, [viaIndex])
      }

      for (const componentIndices of componentIndicesByRoot.values()) {
        if (componentIndices.length < 2) continue
        components.push(componentIndices.map((index) => viasInNet[index]))
      }
    }

    return components
  }

  private getCanonicalVia(component: Via[]) {
    return component.reduce((best, via) => {
      if (via.layers.length > best.layers.length) return via
      if (via.layers.length < best.layers.length) return best

      return via.routeIndex < best.routeIndex ? via : best
    })
  }

  private moveViaTo(viaToRemove: Via, viaKeep: Via, rebuildVias = true) {
    const route = this.mergedViaHdRoutes[viaToRemove.routeIndex].route
    const routeToUpdate = this.mergedViaHdRoutes[viaToRemove.routeIndex]

    for (let i = 0; i < viaToRemove.layers.length; i++) {
      for (let j = route.length - 1; j >= 1; j--) {
        const prev = route[j - 1]
        const curr = route[j]

        if (curr.x === viaToRemove.x && curr.y === viaToRemove.y) {
          route.splice(j, 0, { x: viaKeep.x, y: viaKeep.y, z: curr.z })
          route.splice(j, 0, { x: viaKeep.x, y: viaKeep.y, z: prev.z })

          routeToUpdate.vias = routeToUpdate.vias.map((vx) =>
            vx.x === viaToRemove.x && vx.y === viaToRemove.y
              ? { x: viaKeep.x, y: viaKeep.y }
              : vx,
          )
          this.dedupeRouteVias(routeToUpdate)

          if (rebuildVias) this.rebuildVias()
          return
        }
      }
    }

    routeToUpdate.vias = routeToUpdate.vias.map((vx) =>
      vx.x === viaToRemove.x && vx.y === viaToRemove.y
        ? { x: viaKeep.x, y: viaKeep.y }
        : vx,
    )
    this.dedupeRouteVias(routeToUpdate)

    if (rebuildVias) this.rebuildVias()
  }

  _step() {
    const components = this.getOverlappingViaComponents()

    if (components.length === 0) {
      this.solved = true
      return
    }

    let mergedViaCount = 0
    for (const component of components) {
      const canonicalVia = this.getCanonicalVia(component)
      const canonicalKey = this.getViaKey(canonicalVia)
      for (const via of component) {
        if (this.getViaKey(via) === canonicalKey) continue
        this.moveViaTo(via, canonicalVia, false)
        mergedViaCount++
      }
    }
    this.rebuildVias()
    this.stats.mergedViaComponents = components.length
    this.stats.mergedViaCount = mergedViaCount
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
