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
  IsTerminalCoveredByTrace,
  StitchSegmentRequest,
} from "./SingleHighDensityRouteStitchSolver3"

type ConnectivityLike = {
  areIdsConnected: (a: string, b: string) => boolean
}

type ConnectionName = string
type StitchRequestKey = string
type StitchPathPointKey = string

type IndexedSegment = {
  start: HighDensityIntraNodeRoute["route"][number]
  end: HighDensityIntraNodeRoute["route"][number]
  connectionName: ConnectionName
  traceThickness: number
}

type IndexedVia = {
  x: number
  y: number
  connectionName: ConnectionName
  diameter: number
}

type CollisionBoundary = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  directlyBlocksRequest: boolean
}

const PATH_COORDINATE_EPSILON = 1e-4
const COPPER_OVERLAP_TOLERANCE = 1e-3
const CLEARANCE_COMPARISON_TOLERANCE = 1e-6

const createIndex = (
  boxes: Array<{ minX: number; minY: number; maxX: number; maxY: number }>,
): Flatbush | null => {
  if (boxes.length === 0) return null
  const index = new Flatbush(boxes.length)
  for (const box of boxes) {
    index.add(box.minX, box.minY, box.maxX, box.maxY)
  }
  index.finish()
  return index
}

const getSearchBounds = ({
  start,
  end,
  margin,
}: {
  start: { x: number; y: number }
  end: { x: number; y: number }
  margin: number
}): readonly [number, number, number, number] => {
  return [
    Math.min(start.x, end.x) - margin,
    Math.min(start.y, end.y) - margin,
    Math.max(start.x, end.x) + margin,
    Math.max(start.y, end.y) + margin,
  ]
}

const getRequestKey = (request: StitchSegmentRequest): StitchRequestKey => {
  return [
    request.connectionName,
    request.traceThickness.toFixed(6),
    request.start.x.toFixed(6),
    request.start.y.toFixed(6),
    request.start.z,
    request.end.x.toFixed(6),
    request.end.y.toFixed(6),
    request.end.z,
  ].join(":")
}

const preservesExistingEndpointClearance = ({
  segmentStart,
  segmentEnd,
  existingCopperEndpoints,
  startGap,
  endGap,
  segmentGap,
  requiredGap,
}: {
  segmentStart: Point3
  segmentEnd: Point3
  existingCopperEndpoints: Point3[]
  startGap: number
  endGap: number
  segmentGap: number
  requiredGap: number
}): boolean => {
  const startCanEscape =
    existingCopperEndpoints.some(
      (endpoint) =>
        endpoint.z === segmentStart.z &&
        distance(endpoint, segmentStart) < COPPER_OVERLAP_TOLERANCE,
    ) &&
    startGap < requiredGap &&
    endGap >= requiredGap - CLEARANCE_COMPARISON_TOLERANCE &&
    segmentGap >= startGap - CLEARANCE_COMPARISON_TOLERANCE
  const endCanEscape =
    existingCopperEndpoints.some(
      (endpoint) =>
        endpoint.z === segmentEnd.z &&
        distance(endpoint, segmentEnd) < COPPER_OVERLAP_TOLERANCE,
    ) &&
    endGap < requiredGap &&
    startGap >= requiredGap - CLEARANCE_COMPARISON_TOLERANCE &&
    segmentGap >= endGap - CLEARANCE_COMPARISON_TOLERANCE
  return startCanEscape || endCanEscape
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

const addBoundaryIntersections = ({
  verticalBoundary,
  horizontalBoundary,
  addPoint,
}: {
  verticalBoundary: CollisionBoundary
  horizontalBoundary: CollisionBoundary
  addPoint: (x: number, y: number) => void
}): void => {
  for (const x of [verticalBoundary.minX, verticalBoundary.maxX]) {
    if (x < horizontalBoundary.minX || x > horizontalBoundary.maxX) continue
    for (const y of [horizontalBoundary.minY, horizontalBoundary.maxY]) {
      if (y < verticalBoundary.minY || y > verticalBoundary.maxY) continue
      addPoint(x, y)
    }
  }
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
  isTerminalCoveredByTrace: IsTerminalCoveredByTrace
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
  const rootsByConnection = new Map<ConnectionName, Set<ConnectionName>>()
  let maxTraceRadius = 0
  let maxViaRadius = 0

  for (const route of params.hdRoutes) {
    const roots =
      rootsByConnection.get(route.connectionName) ?? new Set<ConnectionName>()
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

  const areSameNet = (
    firstConnectionName: ConnectionName,
    secondConnectionName: ConnectionName,
  ): boolean => {
    if (
      firstConnectionName === secondConnectionName ||
      params.connMap?.areIdsConnected(firstConnectionName, secondConnectionName)
    ) {
      return true
    }
    const firstRoots =
      rootsByConnection.get(firstConnectionName) ??
      new Set<ConnectionName>([firstConnectionName])
    const secondRoots =
      rootsByConnection.get(secondConnectionName) ??
      new Set<ConnectionName>([secondConnectionName])
    return [...firstRoots].some((root) => secondRoots.has(root))
  }

  const isTerminalCoveredByTrace: IsTerminalCoveredByTrace = ({
    connectionName,
    routeEnd,
    terminal,
    traceThickness,
  }) => {
    if (!terminal.pcb_port_id || routeEnd.z !== terminal.z) return false

    const traceRadius = traceThickness / 2
    for (const obstacleId of obstacleIndex?.search(
      routeEnd.x - traceRadius,
      routeEnd.y - traceRadius,
      routeEnd.x + traceRadius,
      routeEnd.y + traceRadius,
    ) ?? []) {
      const obstacle = obstacles[obstacleId]!
      if (!obstacle.__zLayers?.includes(routeEnd.z)) continue
      if (!obstacle.connectedTo.includes(terminal.pcb_port_id)) continue
      if (!obstacle.connectedTo.some((id) => areSameNet(connectionName, id))) {
        continue
      }
      if (
        segmentToBoxMinDistance(routeEnd, routeEnd, obstacle) <=
        traceRadius + COPPER_OVERLAP_TOLERANCE
      ) {
        return true
      }
    }

    return false
  }

  const segmentValidityCache = new Map<StitchRequestKey, boolean>()

  const evaluateSegmentValidity = (
    { connectionName, start, end, traceThickness }: StitchSegmentRequest,
    existingCopperEndpoints: Point3[],
  ): boolean => {
    const currentTraceRadius = traceThickness / 2
    const obstacleMargin = params.minClearance + currentTraceRadius
    for (const obstacleId of obstacleIndex?.search(
      ...getSearchBounds({ start, end, margin: obstacleMargin }),
    ) ?? []) {
      const obstacle = obstacles[obstacleId]!
      if (!obstacle.__zLayers?.includes(start.z)) continue
      if (obstacle.connectedTo.some((id) => areSameNet(connectionName, id))) {
        continue
      }
      const segmentGap = segmentToBoxMinDistance(start, end, obstacle)
      if (
        segmentGap < obstacleMargin &&
        !preservesExistingEndpointClearance({
          segmentStart: start,
          segmentEnd: end,
          existingCopperEndpoints,
          startGap: segmentToBoxMinDistance(start, start, obstacle),
          endGap: segmentToBoxMinDistance(end, end, obstacle),
          segmentGap,
          requiredGap: obstacleMargin,
        })
      ) {
        return false
      }
    }

    const traceSearchMargin =
      params.minClearance + currentTraceRadius + maxTraceRadius
    for (const segmentId of segmentIndex?.search(
      ...getSearchBounds({ start, end, margin: traceSearchMargin }),
    ) ?? []) {
      const segment = segments[segmentId]!
      if (areSameNet(connectionName, segment.connectionName)) continue
      if (segment.start.z !== start.z) continue
      const requiredGap =
        params.minClearance + currentTraceRadius + segment.traceThickness / 2
      const segmentGap = minimumDistanceBetweenSegments(
        start,
        end,
        segment.start,
        segment.end,
      )
      if (
        segmentGap < requiredGap &&
        !preservesExistingEndpointClearance({
          segmentStart: start,
          segmentEnd: end,
          existingCopperEndpoints,
          startGap: pointToSegmentDistance(start, segment.start, segment.end),
          endGap: pointToSegmentDistance(end, segment.start, segment.end),
          segmentGap,
          requiredGap,
        })
      ) {
        return false
      }
    }

    const viaSearchMargin =
      params.minClearance + currentTraceRadius + maxViaRadius
    for (const viaId of viaIndex?.search(
      ...getSearchBounds({ start, end, margin: viaSearchMargin }),
    ) ?? []) {
      const via = vias[viaId]!
      if (areSameNet(connectionName, via.connectionName)) continue
      const requiredGap =
        params.minClearance + currentTraceRadius + via.diameter / 2
      const segmentGap = pointToSegmentDistance(via, start, end)
      if (
        segmentGap < requiredGap &&
        !preservesExistingEndpointClearance({
          segmentStart: start,
          segmentEnd: end,
          existingCopperEndpoints,
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

  const isValidSegment: IsValidStitchSegment = (request) => {
    const key = getRequestKey(request)
    const cachedResult = segmentValidityCache.get(key)
    if (cachedResult !== undefined) return cachedResult
    const result = evaluateSegmentValidity(request, [
      request.start,
      request.end,
    ])
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
      ...getSearchBounds({ start, end, margin: obstacleMargin }),
    ) ?? []) {
      const obstacle = obstacles[obstacleId]!
      if (!obstacle.__zLayers?.includes(start.z)) continue
      if (obstacle.connectedTo.some((id) => areSameNet(connectionName, id))) {
        continue
      }
      const margin = obstacleMargin + PATH_COORDINATE_EPSILON
      boundaries.push({
        minX: obstacle.center.x - obstacle.width / 2 - margin,
        minY: obstacle.center.y - obstacle.height / 2 - margin,
        maxX: obstacle.center.x + obstacle.width / 2 + margin,
        maxY: obstacle.center.y + obstacle.height / 2 + margin,
        directlyBlocksRequest:
          segmentToBoxMinDistance(start, end, obstacle) < obstacleMargin,
      })
    }

    const traceSearchMargin =
      params.minClearance + currentTraceRadius + maxTraceRadius
    for (const segmentId of segmentIndex?.search(
      ...getSearchBounds({ start, end, margin: traceSearchMargin }),
    ) ?? []) {
      const segment = segments[segmentId]!
      if (segment.start.z !== start.z) continue
      if (areSameNet(connectionName, segment.connectionName)) continue
      const requiredGap =
        params.minClearance + currentTraceRadius + segment.traceThickness / 2
      const margin = requiredGap + PATH_COORDINATE_EPSILON
      boundaries.push({
        minX: Math.min(segment.start.x, segment.end.x) - margin,
        minY: Math.min(segment.start.y, segment.end.y) - margin,
        maxX: Math.max(segment.start.x, segment.end.x) + margin,
        maxY: Math.max(segment.start.y, segment.end.y) + margin,
        directlyBlocksRequest:
          minimumDistanceBetweenSegments(
            start,
            end,
            segment.start,
            segment.end,
          ) < requiredGap,
      })
    }

    const viaSearchMargin =
      params.minClearance + currentTraceRadius + maxViaRadius
    for (const viaId of viaIndex?.search(
      ...getSearchBounds({ start, end, margin: viaSearchMargin }),
    ) ?? []) {
      const via = vias[viaId]!
      if (areSameNet(connectionName, via.connectionName)) continue
      const requiredGap =
        params.minClearance + currentTraceRadius + via.diameter / 2
      const margin = requiredGap + PATH_COORDINATE_EPSILON
      boundaries.push({
        minX: via.x - margin,
        minY: via.y - margin,
        maxX: via.x + margin,
        maxY: via.y + margin,
        directlyBlocksRequest:
          pointToSegmentDistance(via, start, end) < requiredGap,
      })
    }

    const relevantBoundaryIndexes = new Set<number>()
    const pendingBoundaryIndexes: number[] = []
    for (let index = 0; index < boundaries.length; index += 1) {
      if (!boundaries[index]!.directlyBlocksRequest) continue
      relevantBoundaryIndexes.add(index)
      pendingBoundaryIndexes.push(index)
    }
    while (pendingBoundaryIndexes.length > 0) {
      const currentIndex = pendingBoundaryIndexes.pop()!
      const currentBoundary = boundaries[currentIndex]!
      for (let index = 0; index < boundaries.length; index += 1) {
        if (relevantBoundaryIndexes.has(index)) continue
        if (!collisionBoundariesOverlap(currentBoundary, boundaries[index]!)) {
          continue
        }
        relevantBoundaryIndexes.add(index)
        pendingBoundaryIndexes.push(index)
      }
    }

    return [...relevantBoundaryIndexes]
      .sort((a, b) => a - b)
      .map((index) => boundaries[index]!)
  }

  const findUncachedValidPath: FindValidStitchPath = (request) => {
    if (request.start.z !== request.end.z) return undefined
    if (isValidSegment(request)) return [request.start, request.end]

    const boundaries = getCollisionBoundaries(request)
    const points: Point3[] = [request.start, request.end]
    const pointKeys = new Set<StitchPathPointKey>(
      points.map(
        (point) => `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z}`,
      ),
    )

    const addPoint = (x: number, y: number): void => {
      const point = { x, y, z: request.start.z }
      const key = `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z}`
      if (pointKeys.has(key)) return
      if (
        !evaluateSegmentValidity({ ...request, start: point, end: point }, [
          request.start,
          request.end,
        ])
      ) {
        return
      }
      pointKeys.add(key)
      points.push(point)
    }

    for (const boundary of boundaries) {
      for (const [x, y] of [
        [boundary.minX, boundary.minY],
        [boundary.minX, boundary.maxY],
        [boundary.maxX, boundary.minY],
        [boundary.maxX, boundary.maxY],
      ]) {
        addPoint(x!, y!)
      }

      // When an existing endpoint starts inside a clearance boundary, its
      // shortest non-worsening escape is often perpendicular to an edge rather
      // than toward a corner. Preserve the endpoint coordinates as projection
      // vertices on each boundary edge.
      for (const endpoint of [request.start, request.end]) {
        if (
          endpoint.x < boundary.minX ||
          endpoint.x > boundary.maxX ||
          endpoint.y < boundary.minY ||
          endpoint.y > boundary.maxY
        ) {
          continue
        }
        addPoint(boundary.minX, endpoint.y)
        addPoint(boundary.maxX, endpoint.y)
        addPoint(endpoint.x, boundary.minY)
        addPoint(endpoint.x, boundary.maxY)
      }
    }

    // Individual corners are not enough when clearance rectangles overlap:
    // every corner may be buried inside a neighboring rectangle even though
    // the outer boundary of their union still has a legal turn. Add the
    // vertical/horizontal boundary intersections that form those turns.
    for (let firstIndex = 0; firstIndex < boundaries.length; firstIndex += 1) {
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < boundaries.length;
        secondIndex += 1
      ) {
        addBoundaryIntersections({
          verticalBoundary: boundaries[firstIndex]!,
          horizontalBoundary: boundaries[secondIndex]!,
          addPoint,
        })
        addBoundaryIntersections({
          verticalBoundary: boundaries[secondIndex]!,
          horizontalBoundary: boundaries[firstIndex]!,
          addPoint,
        })
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
        if (
          !evaluateSegmentValidity({ ...request, start, end }, [
            request.start,
            request.end,
          ])
        ) {
          continue
        }
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

  const pathCache = new Map<StitchRequestKey, Point3[] | null>()
  const findValidPath: FindValidStitchPath = (request) => {
    const key = getRequestKey(request)
    if (pathCache.has(key)) return pathCache.get(key) ?? undefined
    const path = findUncachedValidPath(request)
    pathCache.set(key, path ?? null)
    return path
  }

  return { isValidSegment, findValidPath, isTerminalCoveredByTrace }
}
