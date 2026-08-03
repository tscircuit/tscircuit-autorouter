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
import { segmentToBoxMinDistance } from "@tscircuit/math-utils"

export interface SameNetViaMergerSolverInput {
  inputHdRoutes: HighDensityRoute[]
  /** Routed copper that participates in collision checks but is never changed. */
  otherHdRoutes?: ReadonlyArray<HighDensityRoute>
  obstacles: Obstacle[]
  colorMap: Record<string, string>
  layerCount: number
  connMap: ConnectivityMap
  outline?: Array<{ x: number; y: number }>
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

const NEAR_VIA_MERGE_DISTANCE_MULTIPLIER = 2.5
const OBSTACLE_MARGIN = 0.1

const tryGetNetForRoute = (
  connMap: ConnectivityMap,
  route: HighDensityRoute,
): string | undefined =>
  connMap.idToNetMap[route.connectionName] ??
  (route.rootConnectionName
    ? (connMap.idToNetMap[route.rootConnectionName] ??
      (connMap.netMap[route.rootConnectionName]
        ? route.rootConnectionName
        : undefined))
    : undefined)

const getNetForRoute = (
  connMap: ConnectivityMap,
  route: HighDensityRoute,
): string => {
  const net = tryGetNetForRoute(connMap, route)
  if (!net) {
    throw new Error(
      `SameNetViaMergerSolver could not find net for route "${route.connectionName}"`,
    )
  }

  return net
}

const obstacleIsSameNet = (
  connMap: ConnectivityMap,
  obstacle: Obstacle,
  via: Via,
): boolean => {
  for (const connectedId of obstacle.connectedTo) {
    if (connectedId === via.net) return true
    if (connMap.idToNetMap[connectedId] === via.net) return true
    if (connMap.areIdsConnected(connectedId, via.net)) return true
  }

  return false
}

const canMoveViaTo = (
  viaToRemove: Via,
  viaKeep: Via,
  context: {
    connMap: ConnectivityMap
    mergedViaHdRoutes: HighDensityRoute[]
    hdRouteSHI: HighDensityRouteSpatialIndex
    obstacleSHI: ObstacleSpatialHashIndex
  },
): boolean => {
  const route = context.mergedViaHdRoutes[viaToRemove.routeIndex]
  if (!route) {
    throw new Error(
      `SameNetViaMergerSolver could not find route for via at index ${viaToRemove.routeIndex}`,
    )
  }

  const transitionLayers = new Set<number>()
  for (let i = 1; i < route.route.length; i++) {
    const prev = route.route[i - 1]
    const curr = route.route[i]
    if (prev.z === curr.z) continue
    if (prev.x !== viaToRemove.x || prev.y !== viaToRemove.y) continue
    if (curr.x !== viaToRemove.x || curr.y !== viaToRemove.y) continue

    transitionLayers.add(prev.z)
    transitionLayers.add(curr.z)
  }

  if (transitionLayers.size === 0) {
    throw new Error(
      `SameNetViaMergerSolver could not find transition layers for via at (${viaToRemove.x}, ${viaToRemove.y})`,
    )
  }

  for (const z of transitionLayers) {
    const traceThickness = route.traceThickness
    const start = { x: viaToRemove.x, y: viaToRemove.y, z }
    const end = { x: viaKeep.x, y: viaKeep.y, z }

    if (start.x === end.x && start.y === end.y) continue

    const conflictingRoutes = context.hdRouteSHI.getConflictingRoutesForSegment(
      start,
      end,
      traceThickness / 2,
    )

    for (const { conflictingRoute, distance } of conflictingRoutes) {
      if (conflictingRoute.connectionName === route.connectionName) continue
      if (
        tryGetNetForRoute(context.connMap, conflictingRoute) === viaToRemove.net
      )
        continue

      const minDistance =
        traceThickness / 2 + conflictingRoute.traceThickness / 2
      if (distance < minDistance) return false
    }

    const segmentBox = {
      centerX: (start.x + end.x) / 2,
      centerY: (start.y + end.y) / 2,
      width: Math.abs(start.x - end.x),
      height: Math.abs(start.y - end.y),
    }
    const searchMargin = traceThickness / 2 + OBSTACLE_MARGIN
    const obstacles = context.obstacleSHI.searchArea(
      segmentBox.centerX,
      segmentBox.centerY,
      segmentBox.width + searchMargin * 2,
      segmentBox.height + searchMargin * 2,
    )

    for (const obstacle of obstacles) {
      if (!obstacle.__zLayers) {
        throw new Error(
          `SameNetViaMergerSolver found obstacle without zLayers near via at (${viaToRemove.x}, ${viaToRemove.y})`,
        )
      }
      if (!obstacle.__zLayers.includes(z)) continue
      if (obstacleIsSameNet(context.connMap, obstacle, viaToRemove)) continue
      if (segmentToBoxMinDistance(start, end, obstacle) < searchMargin) {
        return false
      }
    }
  }

  return true
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
  connMap: ConnectivityMap
  colorMap: Record<string, string>
  outline?: Array<{ x: number; y: number }>
  obstacles: Obstacle[]
  viasByNet: Map<string, Via[]>

  obstacleSHI: ObstacleSpatialHashIndex
  hdRouteSHI: HighDensityRouteSpatialIndex

  private createHdRouteSpatialIndex(): HighDensityRouteSpatialIndex {
    return new HighDensityRouteSpatialIndex([
      ...this.mergedViaHdRoutes,
      ...(this.input.otherHdRoutes ?? []),
    ])
  }

  constructor(private input: SameNetViaMergerSolverInput) {
    super()
    if (!input.connMap) {
      throw new Error("SameNetViaMergerSolver requires connMap")
    }

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
    this.hdRouteSHI = this.createHdRouteSpatialIndex()
    this.vias = []
    this.offendingVias = []
    this.connMap = input.connMap

    this.viasByNet = new Map<string, Via[]>()

    this.rebuildVias()
  }

  private rebuildVias(): void {
    this.vias = []
    this.viasByNet = new Map<string, Via[]>()

    const addRouteVias = (
      route: HighDensityRoute,
      routeIndex: number,
      mutable: boolean,
    ) => {
      if (route.vias.length === 0) return
      const net = mutable
        ? getNetForRoute(this.connMap, route)
        : tryGetNetForRoute(this.connMap, route)
      if (!net) return

      for (let j = 0; j < route.vias.length; j++) {
        const viaPoint = route.vias[j]
        const layers = [...new Set(route.route.map((p) => p.z))]
        if (layers.length === 0) {
          throw new Error(
            `SameNetViaMergerSolver found via on route "${route.connectionName}" with no route points`,
          )
        }

        const via: Via = {
          x: viaPoint.x,
          y: viaPoint.y,
          diameter: route.viaDiameter,
          net,
          layers,
          routeIndex,
          mutable,
        }
        this.vias.push(via)
        const list = this.viasByNet.get(via.net)
        if (list) list.push(via)
        else this.viasByNet.set(via.net, [via])
      }
    }

    for (let i = 0; i < this.mergedViaHdRoutes.length; i++) {
      addRouteVias(this.mergedViaHdRoutes[i]!, i, true)
    }
    for (let i = 0; i < (this.input.otherHdRoutes?.length ?? 0); i++) {
      addRouteVias(
        this.input.otherHdRoutes![i]!,
        this.mergedViaHdRoutes.length + i,
        false,
      )
    }
  }

  private getViaKey(via: Via): string {
    return [
      via.mutable ? "mutable" : "immutable",
      via.routeIndex,
      via.x,
      via.y,
      via.layers.join(","),
      via.net,
    ].join(":")
  }

  private dedupeRouteVias(route: HighDensityRoute): void {
    const seenViaLocations = new Set<string>()
    route.vias = route.vias.filter((via) => {
      const key = `${via.x}:${via.y}`
      if (seenViaLocations.has(key)) return false
      seenViaLocations.add(key)
      return true
    })
  }

  private getOffendingViaGroupsBatch(): Array<{ keep: Via; remove: Via[] }> {
    const groups: Array<{ keep: Via; remove: Via[] }> = []
    const touchedViaKeys = new Set<string>()
    const candidateGroups: Array<{ keep: Via; remove: Via[] }> = []

    for (const viasInNet of this.viasByNet.values()) {
      if (viasInNet.length < 2) continue

      const maxDiameter = Math.max(
        1e-6,
        ...viasInNet.map((via) => via.diameter),
      )
      const cellSize = maxDiameter
      const buckets = new Map<string, number[]>()

      // Build stars instead of connected components so a via is only moved to
      // another via that directly overlaps or has a clear short same-net merge.
      for (let viaIndex = 0; viaIndex < viasInNet.length; viaIndex++) {
        const via = viasInNet[viaIndex]
        const cellX = Math.floor(via.x / cellSize)
        const cellY = Math.floor(via.y / cellSize)
        const bucketKey = `${cellX}:${cellY}`
        const bucket = buckets.get(bucketKey)
        if (bucket) bucket.push(viaIndex)
        else buckets.set(bucketKey, [viaIndex])
      }

      for (let viaIndex = 0; viaIndex < viasInNet.length; viaIndex++) {
        const keep = viasInNet[viaIndex]
        const cellX = Math.floor(keep.x / cellSize)
        const cellY = Math.floor(keep.y / cellSize)
        const neighborCellRadius = Math.ceil(NEAR_VIA_MERGE_DISTANCE_MULTIPLIER)
        const remove: Via[] = []

        for (let dx = -neighborCellRadius; dx <= neighborCellRadius; dx++) {
          for (let dy = -neighborCellRadius; dy <= neighborCellRadius; dy++) {
            const bucket = buckets.get(`${cellX + dx}:${cellY + dy}`)
            if (!bucket) continue

            for (const candidateIndex of bucket) {
              if (candidateIndex === viaIndex) continue

              const candidate = viasInNet[candidateIndex]
              if (!candidate.mutable) continue

              const pairDx = keep.x - candidate.x
              const pairDy = keep.y - candidate.y
              const squaredDistance = pairDx * pairDx + pairDy * pairDy
              const directOverlapDistance =
                keep.diameter / 2 + candidate.diameter / 2
              const nearMergeDistance =
                directOverlapDistance * NEAR_VIA_MERGE_DISTANCE_MULTIPLIER

              if (squaredDistance === 0) {
                if (!keep.mutable) remove.push(candidate)
                continue
              }

              if (
                squaredDistance <=
                directOverlapDistance * directOverlapDistance
              ) {
                remove.push(candidate)
                continue
              }

              if (
                squaredDistance <= nearMergeDistance * nearMergeDistance &&
                canMoveViaTo(candidate, keep, {
                  connMap: this.connMap,
                  mergedViaHdRoutes: this.mergedViaHdRoutes,
                  hdRouteSHI: this.hdRouteSHI,
                  obstacleSHI: this.obstacleSHI,
                })
              ) {
                remove.push(candidate)
              }
            }
          }
        }

        if (remove.length > 0) candidateGroups.push({ keep, remove })
      }
    }

    candidateGroups.sort((a, b) => {
      if (b.remove.length !== a.remove.length) {
        return b.remove.length - a.remove.length
      }
      if (a.keep.mutable !== b.keep.mutable) {
        return a.keep.mutable ? 1 : -1
      }
      if (b.keep.layers.length !== a.keep.layers.length) {
        return b.keep.layers.length - a.keep.layers.length
      }

      return a.keep.routeIndex - b.keep.routeIndex
    })

    for (const candidateGroup of candidateGroups) {
      const keepKey = this.getViaKey(candidateGroup.keep)
      if (touchedViaKeys.has(keepKey)) continue

      const remove = candidateGroup.remove.filter(
        (viaToRemove) => !touchedViaKeys.has(this.getViaKey(viaToRemove)),
      )
      if (remove.length === 0) continue

      groups.push({ keep: candidateGroup.keep, remove })
      touchedViaKeys.add(keepKey)
      for (const viaToRemove of remove) {
        touchedViaKeys.add(this.getViaKey(viaToRemove))
      }
    }

    return groups
  }

  private moveViaTo(viaToRemove: Via, viaKeep: Via, rebuildVias = true): void {
    if (!viaToRemove.mutable) {
      throw new Error(
        "SameNetViaMergerSolver cannot mutate an immutable via anchor",
      )
    }
    const routeToUpdate = this.mergedViaHdRoutes[viaToRemove.routeIndex]
    if (!routeToUpdate) {
      throw new Error(
        `SameNetViaMergerSolver could not find route for via at index ${viaToRemove.routeIndex}`,
      )
    }

    const route = routeToUpdate.route
    const routePointIndexesToMove = new Set<number>()
    let replacedVia = false

    for (let j = route.length - 1; j >= 1; j--) {
      const prev = route[j - 1]
      const curr = route[j]
      if (prev.z === curr.z) continue
      if (prev.x !== viaToRemove.x || prev.y !== viaToRemove.y) continue
      if (curr.x !== viaToRemove.x || curr.y !== viaToRemove.y) continue

      let clusterStartIndex = j - 1
      while (
        clusterStartIndex > 0 &&
        route[clusterStartIndex - 1]!.x === viaToRemove.x &&
        route[clusterStartIndex - 1]!.y === viaToRemove.y
      ) {
        clusterStartIndex--
      }

      let clusterEndIndex = j
      while (
        clusterEndIndex < route.length - 1 &&
        route[clusterEndIndex + 1]!.x === viaToRemove.x &&
        route[clusterEndIndex + 1]!.y === viaToRemove.y
      ) {
        clusterEndIndex++
      }

      for (let k = clusterStartIndex; k <= clusterEndIndex; k++) {
        routePointIndexesToMove.add(k)
      }
    }

    if (routePointIndexesToMove.size === 0) {
      throw new Error(
        `SameNetViaMergerSolver could not find route transition for via at (${viaToRemove.x}, ${viaToRemove.y}) on route "${routeToUpdate.connectionName}"`,
      )
    }

    for (const routePointIndex of routePointIndexesToMove) {
      const point = route[routePointIndex]
      route[routePointIndex] = { ...point, x: viaKeep.x, y: viaKeep.y }
    }

    routeToUpdate.vias = routeToUpdate.vias.flatMap((vx) => {
      if (vx.x !== viaToRemove.x || vx.y !== viaToRemove.y) return vx
      replacedVia = true
      return viaKeep.mutable ? [{ x: viaKeep.x, y: viaKeep.y }] : []
    })
    if (!replacedVia) {
      throw new Error(
        `SameNetViaMergerSolver could not find via at (${viaToRemove.x}, ${viaToRemove.y}) on route "${routeToUpdate.connectionName}"`,
      )
    }

    this.dedupeRouteVias(routeToUpdate)
    if (rebuildVias) this.rebuildVias()
  }

  _step(): void {
    const groups = this.getOffendingViaGroupsBatch()

    if (groups.length === 0) {
      this.solved = true
      return
    }

    let mergedViaCount = 0
    for (const group of groups) {
      for (const viaToRemove of group.remove) {
        this.moveViaTo(viaToRemove, group.keep, false)
        mergedViaCount++
      }
    }
    this.rebuildVias()
    this.hdRouteSHI = this.createHdRouteSpatialIndex()
    this.stats.mergedViaGroups = groups.length
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
