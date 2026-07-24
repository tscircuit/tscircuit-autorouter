import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { BaseSolver } from "../BaseSolver"
import type {
  HighDensityIntraNodeRoute,
  HighDensityRoute,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types"
import type { GraphicsObject } from "graphics-debug"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"
import { segmentToBoxMinDistance } from "@tscircuit/math-utils"
import {
  type SameNetViaMerge,
  visualizeSameNetViaMerger,
} from "./visualize-same-net-via-merger"

export interface SameNetViaMergerSolverInput {
  inputHdRoutes: HighDensityRoute[]
  obstacles: Obstacle[]
  colorMap: Record<string, string>
  layerCount: number
  connMap: ConnectivityMap
  outline?: Array<{ x: number; y: number }>
}

type NetName = string
type ViaBucketKey = string

type Via = {
  x: number
  y: number
  diameter: number
  net: NetName
  routeIndex: number
  layers: number[]
}

type ViaSite = {
  x: number
  y: number
  diameter: number
  net: NetName
  layers: number[]
  members: Via[]
}

type ViaSiteMergeGroup = {
  keep: ViaSite
  remove: ViaSite[]
}

const NEAR_VIA_MERGE_DISTANCE_MULTIPLIER = 2.5
const OBSTACLE_MARGIN = 0.1

const getNetForRoute = (
  connMap: ConnectivityMap,
  route: HighDensityRoute,
): NetName => {
  const net = connMap.idToNetMap[route.connectionName]
  if (!net) {
    throw new Error(
      `SameNetViaMergerSolver could not find net for route "${route.connectionName}"`,
    )
  }

  return net
}

const obstacleIsSameNet = ({
  connMap,
  obstacle,
  net,
}: {
  connMap: ConnectivityMap
  obstacle: Obstacle
  net: NetName
}): boolean => {
  for (const connectedId of obstacle.connectedTo) {
    if (connectedId === net) return true
    if (connMap.idToNetMap[connectedId] === net) return true
    if (connMap.areIdsConnected(connectedId, net)) return true
  }

  return false
}

const getRoutePointIndexesForVia = ({
  route,
  via,
}: {
  route: HighDensityRoute
  via: Via
}): Set<number> => {
  const routePointIndexes = new Set<number>()

  for (
    let routePointIndex = route.route.length - 1;
    routePointIndex >= 1;
    routePointIndex--
  ) {
    const previousPoint = route.route[routePointIndex - 1]!
    const currentPoint = route.route[routePointIndex]!
    if (previousPoint.z === currentPoint.z) continue
    if (previousPoint.x !== via.x || previousPoint.y !== via.y) continue
    if (currentPoint.x !== via.x || currentPoint.y !== via.y) continue

    let clusterStartIndex = routePointIndex - 1
    while (
      clusterStartIndex > 0 &&
      route.route[clusterStartIndex - 1]!.x === via.x &&
      route.route[clusterStartIndex - 1]!.y === via.y
    ) {
      clusterStartIndex--
    }

    let clusterEndIndex = routePointIndex
    while (
      clusterEndIndex < route.route.length - 1 &&
      route.route[clusterEndIndex + 1]!.x === via.x &&
      route.route[clusterEndIndex + 1]!.y === via.y
    ) {
      clusterEndIndex++
    }

    for (
      let clusterPointIndex = clusterStartIndex;
      clusterPointIndex <= clusterEndIndex;
      clusterPointIndex++
    ) {
      routePointIndexes.add(clusterPointIndex)
    }
  }

  return routePointIndexes
}

const isProposedSegmentClear = ({
  start,
  end,
  traceThickness,
  route,
  net,
  connMap,
  hdRouteSpatialIndex,
  obstacleSpatialIndex,
}: {
  start: HighDensityRoute["route"][number]
  end: HighDensityRoute["route"][number]
  traceThickness: number
  route: HighDensityRoute
  net: NetName
  connMap: ConnectivityMap
  hdRouteSpatialIndex: HighDensityRouteSpatialIndex
  obstacleSpatialIndex: ObstacleSpatialHashIndex
}): boolean => {
  if (start.z !== end.z) return true
  if (start.x === end.x && start.y === end.y) return true

  const requiredTraceCenterlineMargin = traceThickness / 2 + OBSTACLE_MARGIN
  const conflictingRoutes = hdRouteSpatialIndex.getConflictingRoutesForSegment(
    start,
    end,
    requiredTraceCenterlineMargin,
  )
  for (const { conflictingRoute } of conflictingRoutes) {
    if (conflictingRoute.connectionName === route.connectionName) continue
    if (getNetForRoute(connMap, conflictingRoute) === net) continue
    return false
  }

  const segmentBox = {
    centerX: (start.x + end.x) / 2,
    centerY: (start.y + end.y) / 2,
    width: Math.abs(start.x - end.x),
    height: Math.abs(start.y - end.y),
  }
  const obstacles = obstacleSpatialIndex.searchArea(
    segmentBox.centerX,
    segmentBox.centerY,
    segmentBox.width + requiredTraceCenterlineMargin * 2,
    segmentBox.height + requiredTraceCenterlineMargin * 2,
  )

  for (const obstacle of obstacles) {
    if (!obstacle.__zLayers) {
      throw new Error(
        `SameNetViaMergerSolver found obstacle without zLayers near proposed segment from (${start.x}, ${start.y}) to (${end.x}, ${end.y})`,
      )
    }
    if (!obstacle.__zLayers.includes(start.z)) continue
    if (obstacleIsSameNet({ connMap, obstacle, net })) continue
    if (
      segmentToBoxMinDistance(start, end, obstacle) <
      requiredTraceCenterlineMargin
    ) {
      return false
    }
  }

  return true
}

const canMoveViaTo = ({
  viaToRemove,
  viaKeep,
  connMap,
  mergedViaHdRoutes,
  hdRouteSpatialIndex,
  obstacleSpatialIndex,
}: {
  viaToRemove: Via
  viaKeep: Via
  connMap: ConnectivityMap
  mergedViaHdRoutes: HighDensityRoute[]
  hdRouteSpatialIndex: HighDensityRouteSpatialIndex
  obstacleSpatialIndex: ObstacleSpatialHashIndex
}): boolean => {
  const route = mergedViaHdRoutes[viaToRemove.routeIndex]
  if (!route) {
    throw new Error(
      `SameNetViaMergerSolver could not find route for via at index ${viaToRemove.routeIndex}`,
    )
  }

  const routePointIndexesToMove = getRoutePointIndexesForVia({
    route,
    via: viaToRemove,
  })
  if (routePointIndexesToMove.size === 0) {
    throw new Error(
      `SameNetViaMergerSolver could not find route transition for via at (${viaToRemove.x}, ${viaToRemove.y})`,
    )
  }

  for (
    let segmentIndex = 0;
    segmentIndex < route.route.length - 1;
    segmentIndex++
  ) {
    const movesStart = routePointIndexesToMove.has(segmentIndex)
    const movesEnd = routePointIndexesToMove.has(segmentIndex + 1)
    if (!movesStart && !movesEnd) continue

    const originalStart = route.route[segmentIndex]!
    const originalEnd = route.route[segmentIndex + 1]!
    const start = movesStart
      ? { ...originalStart, x: viaKeep.x, y: viaKeep.y }
      : originalStart
    const end = movesEnd
      ? { ...originalEnd, x: viaKeep.x, y: viaKeep.y }
      : originalEnd
    if (
      !isProposedSegmentClear({
        start,
        end,
        traceThickness: route.traceThickness,
        route,
        net: viaToRemove.net,
        connMap,
        hdRouteSpatialIndex,
        obstacleSpatialIndex,
      })
    ) {
      return false
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
  viaMerges: SameNetViaMerge[] = []
  currentViaRoutes: HighDensityIntraNodeRoute[] = []
  connMap: ConnectivityMap
  colorMap: Record<string, string>
  outline?: Array<{ x: number; y: number }>
  obstacles: Obstacle[]
  viaSitesByNet: Map<NetName, ViaSite[]>

  obstacleSHI: ObstacleSpatialHashIndex
  hdRouteSHI: HighDensityRouteSpatialIndex

  constructor(private input: SameNetViaMergerSolverInput) {
    super()
    if (!input.connMap) {
      throw new Error("SameNetViaMergerSolver requires connMap")
    }

    this.input = {
      ...input,
      obstacles: createObjectsWithZLayers(input.obstacles, input.layerCount),
    }
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

    this.viaSitesByNet = new Map<NetName, ViaSite[]>()

    this.rebuildVias()
    this.MAX_ITERATIONS = Math.max(1, this.getViaSiteCount())
  }

  private rebuildVias(): void {
    this.vias = []
    const membersBySiteKey = new Map<string, Via[]>()

    for (let i = 0; i < this.mergedViaHdRoutes.length; i++) {
      const route = this.mergedViaHdRoutes[i]
      this.canonicalizeRouteVias(route)
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
        const siteKey = this.getViaSiteKey(via)
        const members = membersBySiteKey.get(siteKey)
        if (members) members.push(via)
        else membersBySiteKey.set(siteKey, [via])
      }
    }

    this.viaSitesByNet = new Map<NetName, ViaSite[]>()
    for (const members of membersBySiteKey.values()) {
      const firstMember = members[0]!
      const site: ViaSite = {
        x: firstMember.x,
        y: firstMember.y,
        diameter: Math.max(...members.map((member) => member.diameter)),
        net: firstMember.net,
        layers: [...new Set(members.flatMap((member) => member.layers))].sort(
          (a, b) => a - b,
        ),
        members,
      }
      const sitesInNet = this.viaSitesByNet.get(site.net)
      if (sitesInNet) sitesInNet.push(site)
      else this.viaSitesByNet.set(site.net, [site])
    }
  }

  private getViaSiteKey(via: Pick<Via, "net" | "x" | "y">): string {
    return JSON.stringify([via.net, via.x, via.y])
  }

  private getViaSiteCount(): number {
    let siteCount = 0
    for (const sitesInNet of this.viaSitesByNet.values()) {
      siteCount += sitesInNet.length
    }
    return siteCount
  }

  private canonicalizeRouteVias(route: HighDensityRoute): void {
    const originalRoute = route.route
    const canonicalRoute: HighDensityRoute["route"] = []

    for (
      let routePointIndex = 0;
      routePointIndex < originalRoute.length;
      routePointIndex++
    ) {
      const currentPoint = originalRoute[routePointIndex]!
      const previousPoint = originalRoute[routePointIndex - 1]
      // Route reconstruction can combine a declared via and its adjacent
      // planar segment into one XY/Z edge. Split it at the declared via.
      if (
        previousPoint &&
        previousPoint.z !== currentPoint.z &&
        previousPoint.toNextSegmentType !== "through_obstacle" &&
        (previousPoint.x !== currentPoint.x ||
          previousPoint.y !== currentPoint.y)
      ) {
        const hasViaAtPreviousPoint = route.vias.some(
          (via) => via.x === previousPoint.x && via.y === previousPoint.y,
        )
        const hasViaAtCurrentPoint = route.vias.some(
          (via) => via.x === currentPoint.x && via.y === currentPoint.y,
        )
        if (hasViaAtPreviousPoint === hasViaAtCurrentPoint) {
          throw new Error(
            `SameNetViaMergerSolver could not resolve a non-vertical layer transition on route "${route.connectionName}"`,
          )
        }

        if (hasViaAtPreviousPoint) {
          canonicalRoute.push({
            x: previousPoint.x,
            y: previousPoint.y,
            z: currentPoint.z,
            ...(currentPoint.traceThickness !== undefined
              ? { traceThickness: currentPoint.traceThickness }
              : {}),
          })
        } else {
          canonicalRoute.push({
            x: currentPoint.x,
            y: currentPoint.y,
            z: previousPoint.z,
            ...(previousPoint.traceThickness !== undefined
              ? { traceThickness: previousPoint.traceThickness }
              : {}),
          })
        }
      }
      canonicalRoute.push(currentPoint)
    }

    route.route = canonicalRoute
    const seenViaLocations = new Set<string>()
    const canonicalVias: HighDensityRoute["vias"] = []
    for (
      let routePointIndex = 1;
      routePointIndex < canonicalRoute.length;
      routePointIndex++
    ) {
      const previousPoint = canonicalRoute[routePointIndex - 1]!
      const currentPoint = canonicalRoute[routePointIndex]!
      if (previousPoint.z === currentPoint.z) continue
      if (previousPoint.toNextSegmentType === "through_obstacle") continue
      if (
        previousPoint.x !== currentPoint.x ||
        previousPoint.y !== currentPoint.y
      ) {
        throw new Error(
          `SameNetViaMergerSolver found a non-vertical layer transition on route "${route.connectionName}"`,
        )
      }

      const key = `${previousPoint.x}:${previousPoint.y}`
      if (seenViaLocations.has(key)) continue
      seenViaLocations.add(key)
      canonicalVias.push({ x: previousPoint.x, y: previousPoint.y })
    }
    route.vias = canonicalVias
  }

  private getOffendingViaGroupsBatch(): ViaSiteMergeGroup[] {
    const groups: ViaSiteMergeGroup[] = []
    const touchedSiteKeys = new Set<string>()
    const candidateGroups: ViaSiteMergeGroup[] = []

    for (const sitesInNet of this.viaSitesByNet.values()) {
      if (sitesInNet.length < 2) continue

      const maxDiameter = Math.max(
        1e-6,
        ...sitesInNet.map((site) => site.diameter),
      )
      const cellSize = maxDiameter
      const buckets = new Map<ViaBucketKey, number[]>()

      // Build stars instead of connected components so a site is only moved
      // to another site that directly overlaps or has a clear short merge.
      for (let siteIndex = 0; siteIndex < sitesInNet.length; siteIndex++) {
        const site = sitesInNet[siteIndex]
        const cellX = Math.floor(site.x / cellSize)
        const cellY = Math.floor(site.y / cellSize)
        const bucketKey = `${cellX}:${cellY}`
        const bucket = buckets.get(bucketKey)
        if (bucket) bucket.push(siteIndex)
        else buckets.set(bucketKey, [siteIndex])
      }

      for (let siteIndex = 0; siteIndex < sitesInNet.length; siteIndex++) {
        const keep = sitesInNet[siteIndex]
        const viaKeep = keep.members[0]!
        const cellX = Math.floor(keep.x / cellSize)
        const cellY = Math.floor(keep.y / cellSize)
        const neighborCellRadius = Math.ceil(NEAR_VIA_MERGE_DISTANCE_MULTIPLIER)
        const remove: ViaSite[] = []

        for (let dx = -neighborCellRadius; dx <= neighborCellRadius; dx++) {
          for (let dy = -neighborCellRadius; dy <= neighborCellRadius; dy++) {
            const bucket = buckets.get(`${cellX + dx}:${cellY + dy}`)
            if (!bucket) continue

            for (const candidateIndex of bucket) {
              if (candidateIndex === siteIndex) continue

              const candidate = sitesInNet[candidateIndex]

              const pairDx = keep.x - candidate.x
              const pairDy = keep.y - candidate.y
              const squaredDistance = pairDx * pairDx + pairDy * pairDy
              const directOverlapDistance =
                keep.diameter / 2 + candidate.diameter / 2
              const nearMergeDistance =
                directOverlapDistance * NEAR_VIA_MERGE_DISTANCE_MULTIPLIER

              if (squaredDistance === 0) continue

              if (
                squaredDistance <= nearMergeDistance * nearMergeDistance &&
                candidate.members.every((viaToRemove) =>
                  canMoveViaTo({
                    viaToRemove,
                    viaKeep,
                    connMap: this.connMap,
                    mergedViaHdRoutes: this.mergedViaHdRoutes,
                    hdRouteSpatialIndex: this.hdRouteSHI,
                    obstacleSpatialIndex: this.obstacleSHI,
                  }),
                )
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
      if (b.keep.layers.length !== a.keep.layers.length) {
        return b.keep.layers.length - a.keep.layers.length
      }

      return a.keep.members[0]!.routeIndex - b.keep.members[0]!.routeIndex
    })

    for (const candidateGroup of candidateGroups) {
      const keepKey = this.getViaSiteKey(candidateGroup.keep)
      if (touchedSiteKeys.has(keepKey)) continue

      const remove = candidateGroup.remove.filter(
        (siteToRemove) =>
          !touchedSiteKeys.has(this.getViaSiteKey(siteToRemove)),
      )
      if (remove.length === 0) continue

      groups.push({ keep: candidateGroup.keep, remove })
      touchedSiteKeys.add(keepKey)
      for (const siteToRemove of remove) {
        touchedSiteKeys.add(this.getViaSiteKey(siteToRemove))
      }
    }

    return groups
  }

  private moveViaTo({
    viaToRemove,
    viaKeep,
    rebuildVias = true,
  }: {
    viaToRemove: Via
    viaKeep: Via
    rebuildVias?: boolean
  }): void {
    const routeToUpdate = this.mergedViaHdRoutes[viaToRemove.routeIndex]
    if (!routeToUpdate) {
      throw new Error(
        `SameNetViaMergerSolver could not find route for via at index ${viaToRemove.routeIndex}`,
      )
    }

    const route = routeToUpdate.route
    const routePointIndexesToMove = getRoutePointIndexesForVia({
      route: routeToUpdate,
      via: viaToRemove,
    })
    let replacedVia = false

    if (routePointIndexesToMove.size === 0) {
      throw new Error(
        `SameNetViaMergerSolver could not find route transition for via at (${viaToRemove.x}, ${viaToRemove.y}) on route "${routeToUpdate.connectionName}"`,
      )
    }

    for (const routePointIndex of routePointIndexesToMove) {
      const point = route[routePointIndex]
      route[routePointIndex] = { ...point, x: viaKeep.x, y: viaKeep.y }
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

    this.viaMerges.push({
      connectionName: routeToUpdate.connectionName,
      from: { x: viaToRemove.x, y: viaToRemove.y },
      to: { x: viaKeep.x, y: viaKeep.y },
    })
    this.canonicalizeRouteVias(routeToUpdate)
    if (rebuildVias) this.rebuildVias()
  }

  _step(): void {
    const previousViaSiteCount = this.getViaSiteCount()
    const groups = this.getOffendingViaGroupsBatch()

    if (groups.length === 0) {
      this.solved = true
      return
    }

    const group = groups[0]!
    const viaKeep = group.keep.members[0]!
    for (const siteToRemove of group.remove) {
      for (const viaToRemove of siteToRemove.members) {
        this.moveViaTo({
          viaToRemove,
          viaKeep,
          rebuildVias: false,
        })
      }
    }
    this.rebuildVias()
    this.hdRouteSHI = new HighDensityRouteSpatialIndex(this.mergedViaHdRoutes)
    const nextViaSiteCount = this.getViaSiteCount()
    if (nextViaSiteCount >= previousViaSiteCount) {
      throw new Error(
        `SameNetViaMergerSolver merge did not reduce physical via sites (${previousViaSiteCount} before, ${nextViaSiteCount} after)`,
      )
    }
    this.stats.mergedViaGroups = Number(this.stats.mergedViaGroups ?? 0) + 1
    this.stats.mergedViaCount =
      Number(this.stats.mergedViaCount ?? 0) +
      group.remove.reduce(
        (removedViaCount, site) => removedViaCount + site.members.length,
        0,
      )
  }

  getMergedViaHdRoutes(): HighDensityRoute[] | null {
    return this.mergedViaHdRoutes
  }

  visualize(): GraphicsObject {
    return visualizeSameNetViaMerger({
      inputHdRoutes: this.inputHdRoutes,
      mergedViaHdRoutes: this.mergedViaHdRoutes,
      obstacles: this.input.obstacles,
      colorMap: this.colorMap,
      viaMerges: this.viaMerges,
    })
  }
}
