import { getBoundFromCenteredRect } from "@tscircuit/math-utils"
import type { Bounds } from "@tscircuit/math-utils"
import type { Point } from "graphics-debug"
import type { CapacityMeshNode } from "lib/types"
import type { Obstacle } from "lib/types"
import type { EdgeSegmentWithObstacle } from "./BgaGapFillTypes"

export const getGapFillEdgeKey = (edge: EdgeSegmentWithObstacle): string =>
  [
    edge.obstacle.obstacleId ?? edge.obstacle.componentId ?? "obstacle",
    edge.start.x.toFixed(4),
    edge.start.y.toFixed(4),
    edge.end.x.toFixed(4),
    edge.end.y.toFixed(4),
    edge.expansionDirection.x,
    edge.expansionDirection.y,
  ].join(":")

const getStringHash = (value: string): number => {
  let hash = 0

  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }

  return hash
}

export const getGapFillEdgeColor = (
  edge: EdgeSegmentWithObstacle,
  opacity: number,
): string => {
  const hue = getStringHash(getGapFillEdgeKey(edge)) % 360
  return `hsla(${hue},72%,36%,${opacity})`
}

export const getGapFillEdgeDirectionLabel = (
  edge: EdgeSegmentWithObstacle,
): string => {
  const direction = edge.expansionDirection

  if (direction.x < 0) return "left"
  if (direction.x > 0) return "right"
  if (direction.y < 0) return "bottom"

  return "top"
}

export const getGapFillEdgeMidpoint = (
  edge: EdgeSegmentWithObstacle,
): Point => {
  const x = (edge.start.x + edge.end.x) / 2
  const y = (edge.start.y + edge.end.y) / 2

  return { x, y }
}

export const getGapFillExpandedNodeEdgeIndex = (
  node: CapacityMeshNode,
): number | null => {
  const match = /^bga-gapfill-(\d+)-/.exec(node.capacityMeshNodeId)
  if (!match) return null

  return Number.parseInt(match[1]!, 10)
}

const compareGapFillEdgesByLocation = (
  edgeA: EdgeSegmentWithObstacle,
  edgeB: EdgeSegmentWithObstacle,
): number => {
  const midpointA = getGapFillEdgeMidpoint(edgeA)
  const midpointB = getGapFillEdgeMidpoint(edgeB)
  const yDelta = midpointA.y - midpointB.y
  if (Math.abs(yDelta) > 1e-6) return yDelta

  const xDelta = midpointA.x - midpointB.x
  if (Math.abs(xDelta) > 1e-6) return xDelta

  return getGapFillEdgeKey(edgeA).localeCompare(getGapFillEdgeKey(edgeB))
}

export const sortGapFillEdgesByLocation = (
  edges: EdgeSegmentWithObstacle[],
): EdgeSegmentWithObstacle[] => {
  const remainingEdges = [...edges].sort(compareGapFillEdgesByLocation)
  const sortedEdges: EdgeSegmentWithObstacle[] = []
  let currentEdge = remainingEdges.shift()

  while (currentEdge) {
    sortedEdges.push(currentEdge)
    if (remainingEdges.length === 0) break

    const currentMidpoint = getGapFillEdgeMidpoint(currentEdge)
    let closestEdgeIndex = 0
    let closestDistance = Number.POSITIVE_INFINITY

    for (let edgeIndex = 0; edgeIndex < remainingEdges.length; edgeIndex++) {
      const candidateEdge = remainingEdges[edgeIndex]!
      const candidateMidpoint = getGapFillEdgeMidpoint(candidateEdge)
      const distance =
        (candidateMidpoint.x - currentMidpoint.x) ** 2 +
        (candidateMidpoint.y - currentMidpoint.y) ** 2

      if (distance < closestDistance - 1e-9) {
        closestDistance = distance
        closestEdgeIndex = edgeIndex
        continue
      }

      if (
        Math.abs(distance - closestDistance) <= 1e-9 &&
        compareGapFillEdgesByLocation(
          candidateEdge,
          remainingEdges[closestEdgeIndex]!,
        ) < 0
      ) {
        closestEdgeIndex = edgeIndex
      }
    }

    currentEdge = remainingEdges.splice(closestEdgeIndex, 1)[0]
  }

  return sortedEdges
}

export const getGapFillEdgeVisualId = (
  edge: EdgeSegmentWithObstacle,
  allEdges: EdgeSegmentWithObstacle[],
): string => {
  const edgeKey = getGapFillEdgeKey(edge)
  const edgeIndex = allEdges.findIndex(
    (candidateEdge) => getGapFillEdgeKey(candidateEdge) === edgeKey,
  )

  if (edgeIndex >= 0) return `E${edgeIndex + 1}`

  return `E${getStringHash(edgeKey).toString(36).slice(0, 4)}`
}

export const getGapFillObstacleEdges = (
  obstacles: Obstacle[],
): EdgeSegmentWithObstacle[] => {
  const edges = obstacles.flatMap((obstacle) => {
    const obstacleBounds: Bounds = getBoundFromCenteredRect(obstacle)

    return [
      {
        obstacle,
        start: { x: obstacleBounds.minX, y: obstacleBounds.minY },
        end: { x: obstacleBounds.minX, y: obstacleBounds.maxY },
        expansionDirection: { x: -1, y: 0 },
      },
      {
        obstacle,
        start: { x: obstacleBounds.maxX, y: obstacleBounds.minY },
        end: { x: obstacleBounds.maxX, y: obstacleBounds.maxY },
        expansionDirection: { x: 1, y: 0 },
      },
      {
        obstacle,
        start: { x: obstacleBounds.minX, y: obstacleBounds.minY },
        end: { x: obstacleBounds.maxX, y: obstacleBounds.minY },
        expansionDirection: { x: 0, y: -1 },
      },
      {
        obstacle,
        start: { x: obstacleBounds.minX, y: obstacleBounds.maxY },
        end: { x: obstacleBounds.maxX, y: obstacleBounds.maxY },
        expansionDirection: { x: 0, y: 1 },
      },
    ]
  })

  return edges
}
