import type { ConnectionPoint } from "lib/types"
import { getConnectionPointLayers } from "lib/utils/connection-point-utils"
import {
  buildMinimumSpanningTree,
  type Edge,
} from "./buildMinimumSpanningTree"

const getPlanarDistance = (a: ConnectionPoint, b: ConnectionPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y)

export const connectionPointsShareLayer = (
  a: ConnectionPoint,
  b: ConnectionPoint,
) => {
  const bLayers = new Set(getConnectionPointLayers(b))
  return getConnectionPointLayers(a).some((layer) => bLayers.has(layer))
}

export const getLayerChangePenalty = (points: ConnectionPoint[]) => {
  if (points.length <= 1) return 1

  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const diagonal = Math.hypot(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
  )

  // A layer change must sort after every possible same-layer edge.
  return Math.max(diagonal, 1) * 2
}

export const getLayerAwareConnectionPointWeight = (
  a: ConnectionPoint,
  b: ConnectionPoint,
  layerChangePenalty: number,
) =>
  getPlanarDistance(a, b) +
  (connectionPointsShareLayer(a, b) ? 0 : layerChangePenalty)

/**
 * Builds one planar tree per copper layer before joining those trees together.
 * This avoids turning a staggered top/bottom pad field into a sequence of
 * unnecessary layer changes merely because opposite-layer pads are close in XY.
 */
export const buildLayerAwareMinimumSpanningTree = (
  points: ConnectionPoint[],
  extraEdges: Edge<ConnectionPoint>[] = [],
): Edge<ConnectionPoint>[] => {
  const layerChangePenalty = getLayerChangePenalty(points)
  const pointsByLayer = new Map<string, ConnectionPoint[]>()

  for (const point of points) {
    for (const layer of new Set(getConnectionPointLayers(point))) {
      const layerPoints = pointsByLayer.get(layer) ?? []
      layerPoints.push(point)
      pointsByLayer.set(layer, layerPoints)
    }
  }

  const sameLayerEdges = [...pointsByLayer.values()].flatMap((layerPoints) =>
    buildMinimumSpanningTree(layerPoints),
  )

  // Ensure the sparse global graph has a candidate between every pair of
  // otherwise separate layer trees, even when each point's nearest XY
  // neighbors all happen to be on its own layer.
  const crossLayerEdges: Edge<ConnectionPoint>[] = []
  const layerGroups = [...pointsByLayer.values()]
  for (let i = 0; i < layerGroups.length; i++) {
    for (let j = i + 1; j < layerGroups.length; j++) {
      let closestPair: [ConnectionPoint, ConnectionPoint] | undefined
      let closestDistance = Infinity

      for (const a of layerGroups[i]!) {
        for (const b of layerGroups[j]!) {
          if (a === b || connectionPointsShareLayer(a, b)) continue
          const distance = getPlanarDistance(a, b)
          if (distance < closestDistance) {
            closestDistance = distance
            closestPair = [a, b]
          }
        }
      }

      if (closestPair) {
        crossLayerEdges.push({
          from: closestPair[0],
          to: closestPair[1],
          weight: closestDistance + layerChangePenalty,
        })
      }
    }
  }

  return buildMinimumSpanningTree(points, {
    extraEdges: [...extraEdges, ...sameLayerEdges, ...crossLayerEdges],
    getEdgeWeight: (from, to, planarDistance) =>
      planarDistance +
      (connectionPointsShareLayer(from, to) ? 0 : layerChangePenalty),
  })
}
