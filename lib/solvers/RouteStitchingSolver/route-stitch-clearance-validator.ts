import {
  pointToSegmentDistance,
  segmentToBoxMinDistance,
  type Point3,
} from "@tscircuit/math-utils"
import { RbushIndex } from "lib/data-structures/RbushIndex"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { doesSegmentCrossPolygonBoundary } from "lib/utils/polygonContainment"

export type StitchSegment = {
  connectionName: string
  start: Point3
  end: Point3
  traceThickness: number
  allowedClearanceViolationEndpoints?: Point3[]
}

export type IsStitchSegmentClear = (stitchSegment: StitchSegment) => boolean
export type FindStitchSegmentPath = (
  stitchSegment: StitchSegment,
) => Point3[] | undefined

type ConnectionName = HighDensityRoute["connectionName"]
type RootConnectionName = NonNullable<HighDensityRoute["rootConnectionName"]>

type ConnectivityLike = {
  areIdsConnected: (firstId: string, secondId: string) => boolean
}

type RouteSegment = StitchSegment

type RouteVia = {
  connectionName: ConnectionName
  x: number
  y: number
  diameter: number
}

type CollisionBoundary = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  directlyBlocksRequest: boolean
}

const DEFAULT_AUTOROUTING_CLEARANCE = 0.1
const CLEARANCE_TOLERANCE = 1e-6
const ENDPOINT_MATCH_TOLERANCE = 1e-6

const removeConsecutiveDuplicatePoints = (points: Point3[]): Point3[] => {
  const deduplicatedPoints: Point3[] = []
  for (const point of points) {
    const previousPoint = deduplicatedPoints[deduplicatedPoints.length - 1]
    if (
      previousPoint &&
      previousPoint.x === point.x &&
      previousPoint.y === point.y
    )
      continue
    deduplicatedPoints.push(point)
  }
  return deduplicatedPoints
}

const getPathKey = (points: Point3[]): string => {
  return points
    .map((point) => `${point.x.toFixed(9)},${point.y.toFixed(9)},${point.z}`)
    .join("|")
}

const collisionBoundariesOverlap = (
  first: CollisionBoundary,
  second: CollisionBoundary,
): boolean => {
  return (
    first.minX <= second.maxX &&
    first.maxX >= second.minX &&
    first.minY <= second.maxY &&
    first.maxY >= second.minY
  )
}

const isEligibleViolationEndpoint = (
  point: Point3,
  eligibleEndpoints: Point3[],
): boolean => {
  return eligibleEndpoints.some(
    (endpoint) =>
      endpoint.z === point.z &&
      Math.hypot(endpoint.x - point.x, endpoint.y - point.y) <
        ENDPOINT_MATCH_TOLERANCE,
  )
}

/**
 * Allows a stitch to leave copper that already violates clearance at one
 * endpoint, provided the stitch never gets closer and exits the violation.
 */
const preservesEndpointClearance = ({
  segmentStart,
  segmentEnd,
  eligibleEndpoints,
  startGap,
  endGap,
  segmentGap,
  requiredGap,
}: {
  segmentStart: Point3
  segmentEnd: Point3
  eligibleEndpoints: Point3[]
  startGap: number
  endGap: number
  segmentGap: number
  requiredGap: number
}): boolean => {
  const escapesFromStart =
    isEligibleViolationEndpoint(segmentStart, eligibleEndpoints) &&
    startGap < requiredGap &&
    endGap >= requiredGap - CLEARANCE_TOLERANCE &&
    segmentGap >= startGap - CLEARANCE_TOLERANCE
  const escapesFromEnd =
    isEligibleViolationEndpoint(segmentEnd, eligibleEndpoints) &&
    endGap < requiredGap &&
    startGap >= requiredGap - CLEARANCE_TOLERANCE &&
    segmentGap >= endGap - CLEARANCE_TOLERANCE
  const preservesExistingViolation =
    startGap < requiredGap &&
    endGap < requiredGap &&
    segmentGap >= Math.min(startGap, endGap) - CLEARANCE_TOLERANCE
  return escapesFromStart || escapesFromEnd || preservesExistingViolation
}

export class RouteStitchClearanceValidator {
  private readonly minClearance: number
  private readonly minBoardEdgeClearance: number
  private readonly areIdsConnected?: ConnectivityLike["areIdsConnected"]
  private readonly outline: Array<{ x: number; y: number }>
  private readonly rootsByConnection = new Map<
    ConnectionName,
    Set<RootConnectionName>
  >()
  private readonly sameNetCache = new Map<
    ConnectionName,
    Map<ConnectionName, boolean>
  >()
  private readonly segments: RouteSegment[] = []
  private readonly vias: RouteVia[] = []
  private readonly obstacles: Obstacle[]
  private segmentIndexesByLayer:
    | Map<number, RbushIndex<RouteSegment>>
    | undefined
  private viaIndex: RbushIndex<RouteVia> | undefined
  private obstacleIndex: RbushIndex<Obstacle> | undefined

  constructor({
    hdRoutes,
    obstacles = [],
    layerCount = 2,
    areIdsConnected,
    outline = [],
    minBoardEdgeClearance = 0,
    minClearance = DEFAULT_AUTOROUTING_CLEARANCE,
  }: {
    hdRoutes: HighDensityRoute[]
    obstacles?: Obstacle[]
    layerCount?: number
    areIdsConnected?: ConnectivityLike["areIdsConnected"]
    outline?: Array<{ x: number; y: number }>
    minBoardEdgeClearance?: number
    minClearance?: number
  }) {
    this.minClearance = minClearance
    this.minBoardEdgeClearance = minBoardEdgeClearance
    this.areIdsConnected = areIdsConnected
    this.outline = outline
    this.obstacles = createObjectsWithZLayers(obstacles, layerCount)
    for (const hdRoute of hdRoutes) {
      this.addRoute(hdRoute)
    }
    this.buildSpatialIndexes()
  }

  addRoute(hdRoute: HighDensityRoute): void {
    const roots =
      this.rootsByConnection.get(hdRoute.connectionName) ?? new Set()
    roots.add(hdRoute.rootConnectionName ?? hdRoute.connectionName)
    this.rootsByConnection.set(hdRoute.connectionName, roots)
    this.sameNetCache.clear()

    for (let index = 0; index < hdRoute.route.length - 1; index += 1) {
      const start = hdRoute.route[index]!
      const end = hdRoute.route[index + 1]!
      if (start.z !== end.z) continue
      if (start.insideJumperPad && end.insideJumperPad) continue
      const segment = {
        connectionName: hdRoute.connectionName,
        start,
        end,
        traceThickness: hdRoute.traceThickness,
      }
      this.segments.push(segment)
      this.insertSegmentIntoSpatialIndex(segment)
    }

    for (const via of hdRoute.vias) {
      const routeVia = {
        connectionName: hdRoute.connectionName,
        x: via.x,
        y: via.y,
        diameter: hdRoute.viaDiameter,
      }
      this.vias.push(routeVia)
      this.insertViaIntoSpatialIndex(routeVia)
    }
  }

  private insertSegmentIntoSpatialIndex(segment: RouteSegment): void {
    if (!this.segmentIndexesByLayer) return
    let index = this.segmentIndexesByLayer.get(segment.start.z)
    if (!index) {
      index = new RbushIndex<RouteSegment>()
      this.segmentIndexesByLayer.set(segment.start.z, index)
    }
    const radius = segment.traceThickness / 2
    index.insert(
      segment,
      Math.min(segment.start.x, segment.end.x) - radius,
      Math.min(segment.start.y, segment.end.y) - radius,
      Math.max(segment.start.x, segment.end.x) + radius,
      Math.max(segment.start.y, segment.end.y) + radius,
    )
  }

  private insertViaIntoSpatialIndex(via: RouteVia): void {
    if (!this.viaIndex) return
    const radius = via.diameter / 2
    this.viaIndex.insert(
      via,
      via.x - radius,
      via.y - radius,
      via.x + radius,
      via.y + radius,
    )
  }

  private buildSpatialIndexes(): void {
    this.segmentIndexesByLayer = new Map()
    const segmentsByLayer = new Map<number, RouteSegment[]>()
    for (const segment of this.segments) {
      const layerSegments = segmentsByLayer.get(segment.start.z)
      if (layerSegments) layerSegments.push(segment)
      else segmentsByLayer.set(segment.start.z, [segment])
    }
    for (const [z, layerSegments] of segmentsByLayer) {
      const index = new RbushIndex<RouteSegment>()
      index.bulkLoad(
        layerSegments.map((segment) => {
          const radius = segment.traceThickness / 2
          return {
            item: segment,
            minX: Math.min(segment.start.x, segment.end.x) - radius,
            minY: Math.min(segment.start.y, segment.end.y) - radius,
            maxX: Math.max(segment.start.x, segment.end.x) + radius,
            maxY: Math.max(segment.start.y, segment.end.y) + radius,
          }
        }),
      )
      this.segmentIndexesByLayer.set(z, index)
    }

    this.viaIndex = new RbushIndex<RouteVia>()
    this.viaIndex.bulkLoad(
      this.vias.map((via) => {
        const radius = via.diameter / 2
        return {
          item: via,
          minX: via.x - radius,
          minY: via.y - radius,
          maxX: via.x + radius,
          maxY: via.y + radius,
        }
      }),
    )

    this.obstacleIndex = new RbushIndex<Obstacle>()
    this.obstacleIndex.bulkLoad(
      this.obstacles.map((obstacle) => ({
        item: obstacle,
        minX: obstacle.center.x - obstacle.width / 2,
        minY: obstacle.center.y - obstacle.height / 2,
        maxX: obstacle.center.x + obstacle.width / 2,
        maxY: obstacle.center.y + obstacle.height / 2,
      })),
    )
  }

  private areSameNet(
    firstConnectionName: ConnectionName,
    secondConnectionName: ConnectionName,
  ): boolean {
    if (firstConnectionName === secondConnectionName) return true
    const cached = this.sameNetCache
      .get(firstConnectionName)
      ?.get(secondConnectionName)
    if (cached !== undefined) return cached
    const firstRoots = this.rootsByConnection.get(firstConnectionName)
    const secondRoots = this.rootsByConnection.get(secondConnectionName)
    let sameNet = Boolean(
      this.areIdsConnected?.(firstConnectionName, secondConnectionName),
    )
    if (firstRoots && secondRoots) {
      for (const root of firstRoots) {
        for (const secondRoot of secondRoots) {
          if (root === secondRoot || this.areIdsConnected?.(root, secondRoot)) {
            sameNet = true
            break
          }
        }
        if (sameNet) break
      }
    }
    let connectionsFromFirst = this.sameNetCache.get(firstConnectionName)
    if (!connectionsFromFirst) {
      connectionsFromFirst = new Map()
      this.sameNetCache.set(firstConnectionName, connectionsFromFirst)
    }
    connectionsFromFirst.set(secondConnectionName, sameNet)
    return sameNet
  }

  private isObstacleOnSameNet(
    connectionName: ConnectionName,
    obstacle: Obstacle,
  ): boolean {
    const connectionIds = new Set<string>([
      connectionName,
      ...(this.rootsByConnection.get(connectionName) ?? []),
    ])
    return obstacle.connectedTo.some((obstacleId) =>
      [...connectionIds].some(
        (connectionId) =>
          connectionId === obstacleId ||
          this.areIdsConnected?.(connectionId, obstacleId),
      ),
    )
  }

  isSegmentClear({
    connectionName,
    start,
    end,
    traceThickness,
    allowedClearanceViolationEndpoints = [start, end],
  }: StitchSegment): boolean {
    const traceRadius = traceThickness / 2
    const queryMargin = this.minClearance + traceRadius
    const queryMinX = Math.min(start.x, end.x) - queryMargin
    const queryMinY = Math.min(start.y, end.y) - queryMargin
    const queryMaxX = Math.max(start.x, end.x) + queryMargin
    const queryMaxY = Math.max(start.y, end.y) + queryMargin

    if (
      this.outline.length >= 3 &&
      doesSegmentCrossPolygonBoundary({
        start,
        end,
        polygon: this.outline,
        margin: this.minBoardEdgeClearance + traceRadius,
      })
    ) {
      return false
    }

    const nearbyObstacles =
      this.obstacleIndex?.search(queryMinX, queryMinY, queryMaxX, queryMaxY) ??
      []
    for (const obstacle of nearbyObstacles) {
      if (!obstacle.__zLayers?.includes(start.z)) continue
      if (this.isObstacleOnSameNet(connectionName, obstacle)) continue
      const segmentGap = segmentToBoxMinDistance(start, end, obstacle)
      if (
        segmentGap < queryMargin &&
        !preservesEndpointClearance({
          segmentStart: start,
          segmentEnd: end,
          eligibleEndpoints: allowedClearanceViolationEndpoints,
          startGap: segmentToBoxMinDistance(start, start, obstacle),
          endGap: segmentToBoxMinDistance(end, end, obstacle),
          segmentGap,
          requiredGap: queryMargin,
        })
      ) {
        return false
      }
    }

    const nearbySegments =
      this.segmentIndexesByLayer
        ?.get(start.z)
        ?.search(queryMinX, queryMinY, queryMaxX, queryMaxY) ?? []
    for (const segment of nearbySegments) {
      if (this.areSameNet(connectionName, segment.connectionName)) continue

      const requiredGap =
        this.minClearance + traceRadius + segment.traceThickness / 2
      const segmentGap = minimumDistanceBetweenSegments(
        start,
        end,
        segment.start,
        segment.end,
      )
      if (
        segmentGap < requiredGap &&
        !preservesEndpointClearance({
          segmentStart: start,
          segmentEnd: end,
          eligibleEndpoints: allowedClearanceViolationEndpoints,
          startGap: pointToSegmentDistance(start, segment.start, segment.end),
          endGap: pointToSegmentDistance(end, segment.start, segment.end),
          segmentGap,
          requiredGap,
        })
      ) {
        return false
      }
    }

    const nearbyVias =
      this.viaIndex?.search(queryMinX, queryMinY, queryMaxX, queryMaxY) ?? []
    for (const via of nearbyVias) {
      if (this.areSameNet(connectionName, via.connectionName)) continue

      const requiredGap = this.minClearance + traceRadius + via.diameter / 2
      const segmentGap = pointToSegmentDistance(via, start, end)
      if (
        segmentGap < requiredGap &&
        !preservesEndpointClearance({
          segmentStart: start,
          segmentEnd: end,
          eligibleEndpoints: allowedClearanceViolationEndpoints,
          startGap: Math.hypot(start.x - via.x, start.y - via.y),
          endGap: Math.hypot(end.x - via.x, end.y - via.y),
          segmentGap,
          requiredGap,
        })
      ) {
        return false
      }
    }

    return true
  }
  findClearPath(stitchSegment: StitchSegment): Point3[] | undefined {
    if (stitchSegment.start.z !== stitchSegment.end.z) return undefined
    if (this.isSegmentClear(stitchSegment)) {
      return [stitchSegment.start, stitchSegment.end]
    }

    const boundaries = this.getRelevantCollisionBoundaries(stitchSegment)
    const visibilityPoints = this.getVisibilityPoints(stitchSegment, boundaries)
    return this.findShortestClearPath(stitchSegment, visibilityPoints)
  }

  private getRelevantCollisionBoundaries(
    stitchSegment: StitchSegment,
  ): CollisionBoundary[] {
    const traceRadius = stitchSegment.traceThickness / 2
    const directDistance = Math.hypot(
      stitchSegment.end.x - stitchSegment.start.x,
      stitchSegment.end.y - stitchSegment.start.y,
    )
    const searchMargin = directDistance + this.minClearance + traceRadius
    const minX =
      Math.min(stitchSegment.start.x, stitchSegment.end.x) - searchMargin
    const minY =
      Math.min(stitchSegment.start.y, stitchSegment.end.y) - searchMargin
    const maxX =
      Math.max(stitchSegment.start.x, stitchSegment.end.x) + searchMargin
    const maxY =
      Math.max(stitchSegment.start.y, stitchSegment.end.y) + searchMargin

    const boundaries: CollisionBoundary[] = []

    for (const obstacle of this.obstacleIndex?.search(minX, minY, maxX, maxY) ??
      []) {
      if (!obstacle.__zLayers?.includes(stitchSegment.start.z)) continue
      if (this.isObstacleOnSameNet(stitchSegment.connectionName, obstacle))
        continue
      const clearance = this.minClearance + traceRadius + CLEARANCE_TOLERANCE
      boundaries.push({
        minX: obstacle.center.x - obstacle.width / 2 - clearance,
        minY: obstacle.center.y - obstacle.height / 2 - clearance,
        maxX: obstacle.center.x + obstacle.width / 2 + clearance,
        maxY: obstacle.center.y + obstacle.height / 2 + clearance,
        directlyBlocksRequest:
          segmentToBoxMinDistance(
            stitchSegment.start,
            stitchSegment.end,
            obstacle,
          ) < clearance,
      })
    }

    for (const segment of this.segmentIndexesByLayer
      ?.get(stitchSegment.start.z)
      ?.search(minX, minY, maxX, maxY) ?? []) {
      if (this.areSameNet(stitchSegment.connectionName, segment.connectionName))
        continue
      const clearance =
        this.minClearance +
        traceRadius +
        segment.traceThickness / 2 +
        CLEARANCE_TOLERANCE
      boundaries.push({
        minX: Math.min(segment.start.x, segment.end.x) - clearance,
        minY: Math.min(segment.start.y, segment.end.y) - clearance,
        maxX: Math.max(segment.start.x, segment.end.x) + clearance,
        maxY: Math.max(segment.start.y, segment.end.y) + clearance,
        directlyBlocksRequest:
          minimumDistanceBetweenSegments(
            stitchSegment.start,
            stitchSegment.end,
            segment.start,
            segment.end,
          ) < clearance,
      })
    }

    for (const via of this.viaIndex?.search(minX, minY, maxX, maxY) ?? []) {
      if (this.areSameNet(stitchSegment.connectionName, via.connectionName))
        continue
      const clearance =
        this.minClearance + traceRadius + via.diameter / 2 + CLEARANCE_TOLERANCE
      boundaries.push({
        minX: via.x - clearance,
        minY: via.y - clearance,
        maxX: via.x + clearance,
        maxY: via.y + clearance,
        directlyBlocksRequest:
          pointToSegmentDistance(via, stitchSegment.start, stitchSegment.end) <
          clearance,
      })
    }

    const boundaryIndex = new RbushIndex<CollisionBoundary>()
    boundaryIndex.bulkLoad(
      boundaries.map((boundary) => ({ item: boundary, ...boundary })),
    )
    const assignedBoundaries = new Set<CollisionBoundary>()
    const mergedBlockingComponents: CollisionBoundary[] = []
    for (const boundary of boundaries) {
      if (!boundary.directlyBlocksRequest || assignedBoundaries.has(boundary))
        continue

      const pendingBoundaries = [boundary]
      assignedBoundaries.add(boundary)
      const componentBoundary = { ...boundary }
      while (pendingBoundaries.length > 0) {
        const currentBoundary = pendingBoundaries.pop()!
        for (const overlappingBoundary of boundaryIndex.search(
          currentBoundary.minX,
          currentBoundary.minY,
          currentBoundary.maxX,
          currentBoundary.maxY,
        )) {
          if (
            assignedBoundaries.has(overlappingBoundary) ||
            !collisionBoundariesOverlap(currentBoundary, overlappingBoundary)
          )
            continue
          assignedBoundaries.add(overlappingBoundary)
          pendingBoundaries.push(overlappingBoundary)
          componentBoundary.minX = Math.min(
            componentBoundary.minX,
            overlappingBoundary.minX,
          )
          componentBoundary.minY = Math.min(
            componentBoundary.minY,
            overlappingBoundary.minY,
          )
          componentBoundary.maxX = Math.max(
            componentBoundary.maxX,
            overlappingBoundary.maxX,
          )
          componentBoundary.maxY = Math.max(
            componentBoundary.maxY,
            overlappingBoundary.maxY,
          )
        }
      }
      mergedBlockingComponents.push(componentBoundary)
    }
    return mergedBlockingComponents
  }

  private getVisibilityPoints(
    stitchSegment: StitchSegment,
    boundaries: CollisionBoundary[],
  ): Point3[] {
    const points: Point3[] = [stitchSegment.start, stitchSegment.end]
    const pointKeys = new Set(points.map((point) => getPathKey([point])))
    const addPoint = (x: number, y: number): void => {
      const point = { x, y, z: stitchSegment.start.z }
      const key = getPathKey([point])
      if (pointKeys.has(key)) return
      pointKeys.add(key)
      points.push(point)
    }

    for (const boundary of boundaries) {
      addPoint(boundary.minX, boundary.minY)
      addPoint(boundary.minX, boundary.maxY)
      addPoint(boundary.maxX, boundary.minY)
      addPoint(boundary.maxX, boundary.maxY)
      for (const endpoint of [stitchSegment.start, stitchSegment.end]) {
        if (
          endpoint.x < boundary.minX ||
          endpoint.x > boundary.maxX ||
          endpoint.y < boundary.minY ||
          endpoint.y > boundary.maxY
        )
          continue
        addPoint(boundary.minX, endpoint.y)
        addPoint(boundary.maxX, endpoint.y)
        addPoint(endpoint.x, boundary.minY)
        addPoint(endpoint.x, boundary.maxY)
      }
    }

    const boardEdgeClearance =
      this.minBoardEdgeClearance +
      stitchSegment.traceThickness / 2 +
      CLEARANCE_TOLERANCE
    for (const outlinePoint of this.outline) {
      for (const xOffset of [-boardEdgeClearance, boardEdgeClearance]) {
        for (const yOffset of [-boardEdgeClearance, boardEdgeClearance]) {
          addPoint(outlinePoint.x + xOffset, outlinePoint.y + yOffset)
        }
      }
    }

    const intermediatePoints = points
      .slice(2)
      .sort((left, right) =>
        getPathKey([left]).localeCompare(getPathKey([right])),
      )
    return [points[0]!, points[1]!, ...intermediatePoints]
  }

  private findShortestClearPath(
    stitchSegment: StitchSegment,
    points: Point3[],
  ): Point3[] | undefined {
    const distances = points.map(() => Infinity)
    const previousIndexes = points.map(() => -1)
    const visited = points.map(() => false)
    const estimatedDistanceToEnd = (pointIndex: number): number => {
      const point = points[pointIndex]!
      return Math.hypot(points[1]!.x - point.x, points[1]!.y - point.y)
    }
    distances[0] = 0
    for (let iteration = 0; iteration < points.length; iteration += 1) {
      let currentIndex = -1
      for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
        if (visited[pointIndex]) continue
        if (
          currentIndex === -1 ||
          distances[pointIndex]! + estimatedDistanceToEnd(pointIndex) <
            distances[currentIndex]! + estimatedDistanceToEnd(currentIndex)
        ) {
          currentIndex = pointIndex
        }
      }
      if (currentIndex === -1 || !Number.isFinite(distances[currentIndex]))
        break
      if (currentIndex === 1) break
      visited[currentIndex] = true

      const relaxCandidate = (candidateIndex: number): void => {
        if (candidateIndex === currentIndex || visited[candidateIndex]) return
        const start = points[currentIndex]!
        const end = points[candidateIndex]!
        const edgeLength = Math.hypot(end.x - start.x, end.y - start.y)
        const candidateDistance = distances[currentIndex]! + edgeLength
        if (candidateDistance >= distances[candidateIndex]!) return
        if (
          !this.isSegmentClear({
            ...stitchSegment,
            start,
            end,
            allowedClearanceViolationEndpoints: [
              stitchSegment.start,
              stitchSegment.end,
            ],
          })
        )
          return
        distances[candidateIndex] = candidateDistance
        previousIndexes[candidateIndex] = currentIndex
      }

      // Check the destination first so a short route does not require building
      // the complete visibility graph.
      relaxCandidate(1)
      for (
        let candidateIndex = 2;
        candidateIndex < points.length;
        candidateIndex += 1
      ) {
        relaxCandidate(candidateIndex)
      }
    }
    if (!Number.isFinite(distances[1])) return undefined

    const path: Point3[] = []
    for (let pointIndex = 1; pointIndex !== -1; ) {
      path.push(points[pointIndex]!)
      pointIndex = previousIndexes[pointIndex]!
    }
    path.reverse()
    return removeConsecutiveDuplicatePoints(path)
  }
}
