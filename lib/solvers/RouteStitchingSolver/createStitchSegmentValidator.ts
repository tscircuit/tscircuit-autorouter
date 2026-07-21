import {
  pointToSegmentDistance,
  segmentToBoxMinDistance,
} from "@tscircuit/math-utils"
import Flatbush from "flatbush"
import type { Obstacle } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import type { IsValidStitchSegment } from "./SingleHighDensityRouteStitchSolver3"

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
export const createStitchSegmentValidator = (params: {
  hdRoutes: HighDensityIntraNodeRoute[]
  obstacles: Obstacle[]
  layerCount: number
  connMap?: ConnectivityLike
  minClearance: number
}): IsValidStitchSegment => {
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
    const aRoots = rootsByConnection.get(a)
    const bRoots = rootsByConnection.get(b)
    return Boolean(
      aRoots && bRoots && [...aRoots].some((root) => bRoots.has(root)),
    )
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

  return ({ connectionName, start, end, traceThickness }) => {
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
}
