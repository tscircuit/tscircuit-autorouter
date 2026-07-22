import {
  distance,
  pointToSegmentDistance,
  segmentToBoxMinDistance,
  type Point3,
} from "@tscircuit/math-utils"
import Flatbush from "flatbush"
import type { Obstacle } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import type {
  FindValidStitchPath,
  IsValidStitchSegment,
  StitchSegmentRequest,
} from "./SingleHighDensityRouteStitchSolver3"

type ConnectivityLike = {
  areIdsConnected: (a: string, b: string) => boolean
}

type IndexedSegment = {
  start: HighDensityIntraNodeRoute["route"][number]
  end: HighDensityIntraNodeRoute["route"][number]
  connectionName: string
  traceThickness: number
}

type IndexedVia = {
  x: number
  y: number
  connectionName: string
  diameter: number
}

type CollisionBoundary = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const PATH_COORDINATE_EPSILON = 1e-4

const createIndex = (
  boxes: Array<{ minX: number; minY: number; maxX: number; maxY: number }>,
) => {
  if (boxes.length === 0) return null
  const index = new Flatbush(boxes.length)
  for (const box of boxes) {
    index.add(box.minX, box.minY, box.maxX, box.maxY)
  }
  index.finish()
  return index
}

/**
 * Builds an indexed collision oracle for the short pieces of copper that the
 * stitcher may add between route fragments or between a fragment and terminal.
 */
export const createStitchSegmentRouter = (params: {
  hdRoutes: HighDensityIntraNodeRoute[]
  obstacles: Obstacle[]
  layerCount: number
  connMap?: ConnectivityLike
  minClearance: number
}): {
  isValidSegment: IsValidStitchSegment
  findValidPath: FindValidStitchPath
} => {
  const obstacles = createObjectsWithZLayers(
    params.obstacles,
    params.layerCount,
  )
  const obstacleIndex = createIndex(
    obstacles.map((obstacle) => ({
      minX: obstacle.center.x - obstacle.width / 2,
      minY: obstacle.center.y - obstacle.height / 2,
      maxX: obstacle.center.x + obstacle.width / 2,
      maxY: obstacle.center.y + obstacle.height / 2,
    })),
  )

  const segments: IndexedSegment[] = []
  const vias: IndexedVia[] = []
  const rootsByConnection = new Map<string, Set<string>>()
  let maxTraceRadius = 0
  let maxViaRadius = 0

  for (const route of params.hdRoutes) {
    const roots = rootsByConnection.get(route.connectionName) ?? new Set()
    roots.add(route.rootConnectionName ?? route.connectionName)
    rootsByConnection.set(route.connectionName, roots)
    maxTraceRadius = Math.max(maxTraceRadius, route.traceThickness / 2)
    maxViaRadius = Math.max(maxViaRadius, route.viaDiameter / 2)

    for (let i = 0; i < route.route.length - 1; i++) {
      const start = route.route[i]!
      const end = route.route[i + 1]!
      if (start.z !== end.z) continue
      segments.push({
        start,
        end,
        connectionName: route.connectionName,
        traceThickness: route.traceThickness,
      })
    }
    for (const via of route.vias) {
      vias.push({
        ...via,
        connectionName: route.connectionName,
        diameter: route.viaDiameter,
      })
    }
  }

  const segmentIndex = createIndex(
    segments.map(({ start, end }) => ({
      minX: Math.min(start.x, end.x),
      minY: Math.min(start.y, end.y),
      maxX: Math.max(start.x, end.x),
      maxY: Math.max(start.y, end.y),
    })),
  )
  const viaIndex = createIndex(
    vias.map((via) => ({
      minX: via.x,
      minY: via.y,
      maxX: via.x,
      maxY: via.y,
    })),
  )

  const areSameNet = (a: string, b: string) => {
    if (a === b || params.connMap?.areIdsConnected(a, b)) return true
    const aRoots = rootsByConnection.get(a) ?? new Set([a])
    const bRoots = rootsByConnection.get(b) ?? new Set([b])
    return [...aRoots].some((root) => bRoots.has(root))
  }

  const getSearchBounds = (
    start: { x: number; y: number },
    end: { x: number; y: number },
    margin: number,
  ) =>
    [
      Math.min(start.x, end.x) - margin,
      Math.min(start.y, end.y) - margin,
      Math.max(start.x, end.x) + margin,
      Math.max(start.y, end.y) + margin,
    ] as const

  const getRequestKey = (request: StitchSegmentRequest) =>
    [
      request.connectionName,
      request.traceThickness.toFixed(6),
      request.start.x.toFixed(6),
      request.start.y.toFixed(6),
      request.start.z,
      request.end.x.toFixed(6),
      request.end.y.toFixed(6),
      request.end.z,
    ].join(":")
  const segmentValidityCache = new Map<string, boolean>()

  const evaluateSegmentValidity: IsValidStitchSegment = ({
    connectionName,
    start,
    end,
    traceThickness,
  }) => {
    const currentTraceRadius = traceThickness / 2
    const obstacleMargin = params.minClearance + currentTraceRadius
    for (const obstacleId of obstacleIndex?.search(
      ...getSearchBounds(start, end, obstacleMargin),
    ) ?? []) {
      const obstacle = obstacles[obstacleId]!
      if (!obstacle.__zLayers?.includes(start.z)) continue
      if (obstacle.connectedTo.some((id) => areSameNet(connectionName, id))) {
        continue
      }
      if (segmentToBoxMinDistance(start, end, obstacle) < obstacleMargin) {
        return false
      }
    }

    const traceSearchMargin =
      params.minClearance + currentTraceRadius + maxTraceRadius
    for (const segmentId of segmentIndex?.search(
      ...getSearchBounds(start, end, traceSearchMargin),
    ) ?? []) {
      const segment = segments[segmentId]!
      if (areSameNet(connectionName, segment.connectionName)) continue
      if (segment.start.z !== start.z) continue
      const requiredGap =
        params.minClearance + currentTraceRadius + segment.traceThickness / 2
      if (
        minimumDistanceBetweenSegments(start, end, segment.start, segment.end) <
        requiredGap
      ) {
        return false
      }
    }

    const viaSearchMargin =
      params.minClearance + currentTraceRadius + maxViaRadius
    for (const viaId of viaIndex?.search(
      ...getSearchBounds(start, end, viaSearchMargin),
    ) ?? []) {
      const via = vias[viaId]!
      if (areSameNet(connectionName, via.connectionName)) continue
      const requiredGap =
        params.minClearance + currentTraceRadius + via.diameter / 2
      if (pointToSegmentDistance(via, start, end) < requiredGap) return false
    }

    return true
  }

  const isValidSegment: IsValidStitchSegment = (request) => {
    const key = getRequestKey(request)
    const cachedResult = segmentValidityCache.get(key)
    if (cachedResult !== undefined) return cachedResult
    const result = evaluateSegmentValidity(request)
    segmentValidityCache.set(key, result)
    return result
  }

  const getCollisionBoundaries = ({
    connectionName,
    start,
    end,
    traceThickness,
  }: StitchSegmentRequest): CollisionBoundary[] => {
    const currentTraceRadius = traceThickness / 2
    const boundaries: CollisionBoundary[] = []

    const obstacleMargin = params.minClearance + currentTraceRadius
    for (const obstacleId of obstacleIndex?.search(
      ...getSearchBounds(start, end, obstacleMargin),
    ) ?? []) {
      const obstacle = obstacles[obstacleId]!
      if (!obstacle.__zLayers?.includes(start.z)) continue
      if (obstacle.connectedTo.some((id) => areSameNet(connectionName, id))) {
        continue
      }
      if (segmentToBoxMinDistance(start, end, obstacle) >= obstacleMargin) {
        continue
      }
      const margin = obstacleMargin + PATH_COORDINATE_EPSILON
      boundaries.push({
        minX: obstacle.center.x - obstacle.width / 2 - margin,
        minY: obstacle.center.y - obstacle.height / 2 - margin,
        maxX: obstacle.center.x + obstacle.width / 2 + margin,
        maxY: obstacle.center.y + obstacle.height / 2 + margin,
      })
    }

    const traceSearchMargin =
      params.minClearance + currentTraceRadius + maxTraceRadius
    for (const segmentId of segmentIndex?.search(
      ...getSearchBounds(start, end, traceSearchMargin),
    ) ?? []) {
      const segment = segments[segmentId]!
      if (segment.start.z !== start.z) continue
      if (areSameNet(connectionName, segment.connectionName)) continue
      const requiredGap =
        params.minClearance + currentTraceRadius + segment.traceThickness / 2
      if (
        minimumDistanceBetweenSegments(
          start,
          end,
          segment.start,
          segment.end,
        ) >= requiredGap
      ) {
        continue
      }
      const margin = requiredGap + PATH_COORDINATE_EPSILON
      boundaries.push({
        minX: Math.min(segment.start.x, segment.end.x) - margin,
        minY: Math.min(segment.start.y, segment.end.y) - margin,
        maxX: Math.max(segment.start.x, segment.end.x) + margin,
        maxY: Math.max(segment.start.y, segment.end.y) + margin,
      })
    }

    const viaSearchMargin =
      params.minClearance + currentTraceRadius + maxViaRadius
    for (const viaId of viaIndex?.search(
      ...getSearchBounds(start, end, viaSearchMargin),
    ) ?? []) {
      const via = vias[viaId]!
      if (areSameNet(connectionName, via.connectionName)) continue
      const requiredGap =
        params.minClearance + currentTraceRadius + via.diameter / 2
      if (pointToSegmentDistance(via, start, end) >= requiredGap) continue
      const margin = requiredGap + PATH_COORDINATE_EPSILON
      boundaries.push({
        minX: via.x - margin,
        minY: via.y - margin,
        maxX: via.x + margin,
        maxY: via.y + margin,
      })
    }

    return boundaries
  }

  const findUncachedValidPath: FindValidStitchPath = (request) => {
    if (request.start.z !== request.end.z) return undefined
    if (isValidSegment(request)) return [request.start, request.end]

    const boundaries = getCollisionBoundaries(request)
    const points: Point3[] = [request.start, request.end]
    const pointKeys = new Set(
      points.map(
        (point) => `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z}`,
      ),
    )

    for (const boundary of boundaries) {
      for (const point of [
        { x: boundary.minX, y: boundary.minY, z: request.start.z },
        { x: boundary.minX, y: boundary.maxY, z: request.start.z },
        { x: boundary.maxX, y: boundary.minY, z: request.start.z },
        { x: boundary.maxX, y: boundary.maxY, z: request.start.z },
      ]) {
        const key = `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z}`
        if (pointKeys.has(key)) continue
        pointKeys.add(key)
        points.push(point)
      }
    }

    const edges: Array<Array<{ index: number; length: number }>> = points.map(
      () => [],
    )
    for (let firstIndex = 0; firstIndex < points.length; firstIndex += 1) {
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < points.length;
        secondIndex += 1
      ) {
        const start = points[firstIndex]!
        const end = points[secondIndex]!
        if (!isValidSegment({ ...request, start, end })) continue
        const length = distance(start, end)
        edges[firstIndex]!.push({ index: secondIndex, length })
        edges[secondIndex]!.push({ index: firstIndex, length })
      }
    }

    const shortestDistances = points.map(() => Infinity)
    const previousPointIndices = points.map(() => -1)
    const visited = points.map(() => false)
    shortestDistances[0] = 0

    for (let iteration = 0; iteration < points.length; iteration += 1) {
      let currentIndex = -1
      for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
        if (visited[pointIndex]) continue
        if (
          currentIndex === -1 ||
          shortestDistances[pointIndex]! < shortestDistances[currentIndex]!
        ) {
          currentIndex = pointIndex
        }
      }

      if (
        currentIndex === -1 ||
        !Number.isFinite(shortestDistances[currentIndex])
      ) {
        break
      }
      if (currentIndex === 1) break
      visited[currentIndex] = true

      for (const edge of edges[currentIndex]!) {
        if (visited[edge.index]) continue
        const candidateDistance = shortestDistances[currentIndex]! + edge.length
        if (candidateDistance < shortestDistances[edge.index]!) {
          shortestDistances[edge.index] = candidateDistance
          previousPointIndices[edge.index] = currentIndex
        }
      }
    }

    if (!Number.isFinite(shortestDistances[1])) return undefined

    const path: Point3[] = []
    for (let pointIndex = 1; pointIndex !== -1; ) {
      path.push(points[pointIndex]!)
      pointIndex = previousPointIndices[pointIndex]!
    }
    path.reverse()
    return path
  }

  const pathCache = new Map<string, Point3[] | null>()
  const findValidPath: FindValidStitchPath = (request) => {
    const key = getRequestKey(request)
    if (pathCache.has(key)) return pathCache.get(key) ?? undefined
    const path = findUncachedValidPath(request)
    pathCache.set(key, path ?? null)
    return path
  }

  return { isValidSegment, findValidPath }
}

export const createStitchSegmentValidator = (
  params: Parameters<typeof createStitchSegmentRouter>[0],
): IsValidStitchSegment => createStitchSegmentRouter(params).isValidSegment
