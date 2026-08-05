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
}

type ViaMergeGroup = {
  keep: Via
  remove: Via[]
}

const NEAR_VIA_MERGE_DISTANCE_MULTIPLIER = 2.5
const OBSTACLE_MARGIN = 0.1

const tryGetNetForRoute = (
  connMap: ConnectivityMap,
  route: HighDensityRoute,
): string | undefined =>
  connMap.idToNetMap[route.connectionName] ??
  (route.rootConnectionName
    ? connMap.idToNetMap[route.rootConnectionName]
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

const getViaTransitionPointIndexes = (
  route: HighDensityRoute,
  via: Via,
): Set<number> => {
  const indexes = new Set<number>()

  for (let index = route.route.length - 1; index >= 1; index--) {
    const previousPoint = route.route[index - 1]
    const currentPoint = route.route[index]
    if (previousPoint.z === currentPoint.z) continue
    if (previousPoint.x !== via.x || previousPoint.y !== via.y) continue
    if (currentPoint.x !== via.x || currentPoint.y !== via.y) continue

    let clusterStartIndex = index - 1
    while (
      clusterStartIndex > 0 &&
      route.route[clusterStartIndex - 1]!.x === via.x &&
      route.route[clusterStartIndex - 1]!.y === via.y
    ) {
      clusterStartIndex--
    }

    let clusterEndIndex = index
    while (
      clusterEndIndex < route.route.length - 1 &&
      route.route[clusterEndIndex + 1]!.x === via.x &&
      route.route[clusterEndIndex + 1]!.y === via.y
    ) {
      clusterEndIndex++
    }

    for (
      let pointIndex = clusterStartIndex;
      pointIndex <= clusterEndIndex;
      pointIndex++
    ) {
      indexes.add(pointIndex)
    }
  }

  return indexes
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

  const movedPointIndexes = getViaTransitionPointIndexes(route, viaToRemove)
  if (movedPointIndexes.size === 0) {
    throw new Error(
      `SameNetViaMergerSolver could not find route transition for via at (${viaToRemove.x}, ${viaToRemove.y}) on route "${route.connectionName}"`,
    )
  }

  for (let index = 1; index < route.route.length; index++) {
    if (
      !movedPointIndexes.has(index - 1) &&
      !movedPointIndexes.has(index)
    ) {
      continue
    }

    const previousPoint = route.route[index - 1]
    const currentPoint = route.route[index]
    if (previousPoint.z !== currentPoint.z) continue

    const traceThickness = route.traceThickness
    const start = movedPointIndexes.has(index - 1)
      ? { ...previousPoint, x: viaKeep.x, y: viaKeep.y }
      : previousPoint
    const end = movedPointIndexes.has(index)
      ? { ...currentPoint, x: viaKeep.x, y: viaKeep.y }
      : currentPoint

    if (start.x === end.x && start.y === end.y) continue

    const conflictingRoutes = context.hdRouteSHI.getConflictingRoutesForSegment(
      start,
      end,
      traceThickness / 2,
    )

    for (const { conflictingRoute } of conflictingRoutes) {
      if (conflictingRoute.connectionName === route.connectionName) continue
      if (
        tryGetNetForRoute(context.connMap, conflictingRoute) === viaToRemove.net
      )
        continue

      return false
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
      if (!obstacle.__zLayers.includes(start.z)) continue
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

    for (let i = 0; i < this.mergedViaHdRoutes.length; i++) {
      const route = this.mergedViaHdRoutes[i]
      this.dedupeRouteVias(route)
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
          net: getNetForRoute(this.connMap, route),
          layers,
          routeIndex: i,
        }
        this.vias.push(via)
        const list = this.viasByNet.get(via.net)
        if (list) list.push(via)
        else this.viasByNet.set(via.net, [via])
      }
    }
  }

  private getViaLocationKey(via: Via): string {
    return `${via.net}:${via.x}:${via.y}`
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

  private canMergeViaTo(viaToRemove: Via, viaKeep: Via): boolean {
    const dx = viaKeep.x - viaToRemove.x
    const dy = viaKeep.y - viaToRemove.y
    const squaredDistance = dx * dx + dy * dy
    const directOverlapDistance =
      viaKeep.diameter / 2 + viaToRemove.diameter / 2

    if (squaredDistance === 0) return false

    const nearMergeDistance =
      directOverlapDistance * NEAR_VIA_MERGE_DISTANCE_MULTIPLIER
    if (squaredDistance > nearMergeDistance * nearMergeDistance) return false

    return canMoveViaTo(viaToRemove, viaKeep, {
      connMap: this.connMap,
      mergedViaHdRoutes: this.mergedViaHdRoutes,
      hdRouteSHI: this.hdRouteSHI,
      obstacleSHI: this.obstacleSHI,
    })
  }

  private getNextOffendingViaGroup(): ViaMergeGroup | null {
    const candidateGroups: ViaMergeGroup[] = []

    for (const viasInNet of this.viasByNet.values()) {
      if (viasInNet.length < 2) continue

      const viasByLocation = new Map<string, Via[]>()
      for (const via of viasInNet) {
        const locationKey = this.getViaLocationKey(via)
        const viasAtLocation = viasByLocation.get(locationKey)
        if (viasAtLocation) viasAtLocation.push(via)
        else viasByLocation.set(locationKey, [via])
      }

      if (viasByLocation.size < 2) continue

      const maxDiameter = Math.max(
        1e-6,
        ...viasInNet.map((via) => via.diameter),
      )
      const cellSize = maxDiameter
      const buckets = new Map<string, number[]>()

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
        const keepLocationKey = this.getViaLocationKey(keep)
        const cellX = Math.floor(keep.x / cellSize)
        const cellY = Math.floor(keep.y / cellSize)
        const neighborCellRadius = Math.ceil(
          NEAR_VIA_MERGE_DISTANCE_MULTIPLIER,
        )
        const removeLocationKeys = new Set<string>()

        for (let dx = -neighborCellRadius; dx <= neighborCellRadius; dx++) {
          for (let dy = -neighborCellRadius; dy <= neighborCellRadius; dy++) {
            const bucket = buckets.get(`${cellX + dx}:${cellY + dy}`)
            if (!bucket) continue

            for (const candidateIndex of bucket) {
              if (candidateIndex === viaIndex) continue

              const candidate = viasInNet[candidateIndex]
              const candidateLocationKey = this.getViaLocationKey(candidate)
              if (
                candidateLocationKey === keepLocationKey ||
                removeLocationKeys.has(candidateLocationKey)
              ) {
                continue
              }

              const candidateLocation = viasByLocation.get(
                candidateLocationKey,
              )
              if (!candidateLocation) {
                throw new Error(
                  `SameNetViaMergerSolver lost via location "${candidateLocationKey}"`,
                )
              }

              // Vias already sharing one same-net coordinate form one physical
              // merge unit. Moving only part can undo an earlier merge.
              if (
                candidateLocation.every((viaToRemove) =>
                  this.canMergeViaTo(viaToRemove, keep),
                )
              ) {
                removeLocationKeys.add(candidateLocationKey)
              }
            }
          }
        }

        const remove = [...removeLocationKeys].flatMap((locationKey) => {
          const viasAtLocation = viasByLocation.get(locationKey)
          if (!viasAtLocation) {
            throw new Error(
              `SameNetViaMergerSolver lost via location "${locationKey}"`,
            )
          }
          return viasAtLocation
        })
        if (remove.length > 0) {
          candidateGroups.push({ keep, remove })
        }
      }
    }

    candidateGroups.sort((a, b) => {
      if (b.remove.length !== a.remove.length) {
        return b.remove.length - a.remove.length
      }
      if (b.keep.layers.length !== a.keep.layers.length) {
        return b.keep.layers.length - a.keep.layers.length
      }

      return a.keep.routeIndex - b.keep.routeIndex
    })

    return candidateGroups[0] ?? null
  }

  private moveViaTo(viaToRemove: Via, viaKeep: Via, rebuildVias = true): void {
    const routeToUpdate = this.mergedViaHdRoutes[viaToRemove.routeIndex]
    if (!routeToUpdate) {
      throw new Error(
        `SameNetViaMergerSolver could not find route for via at index ${viaToRemove.routeIndex}`,
      )
    }

    const routePointIndexesToMove = getViaTransitionPointIndexes(
      routeToUpdate,
      viaToRemove,
    )
    let replacedVia = false

    if (routePointIndexesToMove.size === 0) {
      throw new Error(
        `SameNetViaMergerSolver could not find route transition for via at (${viaToRemove.x}, ${viaToRemove.y}) on route "${routeToUpdate.connectionName}"`,
      )
    }

    for (const routePointIndex of routePointIndexesToMove) {
      const point = routeToUpdate.route[routePointIndex]
      routeToUpdate.route[routePointIndex] = {
        ...point,
        x: viaKeep.x,
        y: viaKeep.y,
      }
    }

    routeToUpdate.vias = routeToUpdate.vias.map((vx) => {
      if (vx.x !== viaToRemove.x || vx.y !== viaToRemove.y) return vx
      replacedVia = true
      return { x: viaKeep.x, y: viaKeep.y }
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
    const group = this.getNextOffendingViaGroup()

    if (!group) {
      this.solved = true
      return
    }

    for (const viaToRemove of group.remove) {
      this.moveViaTo(viaToRemove, group.keep, false)
    }
    this.rebuildVias()
    // The next merge must be checked against the geometry created by this one.
    this.hdRouteSHI = this.createHdRouteSpatialIndex()
    this.stats.mergedViaGroups = 1
    this.stats.mergedViaCount = group.remove.length
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
