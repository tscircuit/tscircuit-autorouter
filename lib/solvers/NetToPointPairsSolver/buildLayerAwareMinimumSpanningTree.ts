import type { ConnectionPoint } from "lib/types"
import { getConnectionPointLayers } from "lib/utils/connection-point-utils"
import {
  buildMinimumSpanningTree,
  type Edge,
} from "./buildMinimumSpanningTree"

type LayerAwareConnectionPointWeightParams = {
  firstPoint: ConnectionPoint
  secondPoint: ConnectionPoint
  layerChangePenalty: number
}

const getPlanarDistance = (
  firstPoint: ConnectionPoint,
  secondPoint: ConnectionPoint,
): number =>
  Math.hypot(firstPoint.x - secondPoint.x, firstPoint.y - secondPoint.y)

export const connectionPointsShareLayer = (
  firstPoint: ConnectionPoint,
  secondPoint: ConnectionPoint,
): boolean => {
  const secondPointLayers = new Set(getConnectionPointLayers(secondPoint))
  return getConnectionPointLayers(firstPoint).some((layer) =>
    secondPointLayers.has(layer),
  )
}

export const getLayerChangePenalty = (
  points: ConnectionPoint[],
): number => {
  if (points.length <= 1) return 1

  const xCoordinates = points.map(({ x }) => x)
  const yCoordinates = points.map(({ y }) => y)
  const diagonal = Math.hypot(
    Math.max(...xCoordinates) - Math.min(...xCoordinates),
    Math.max(...yCoordinates) - Math.min(...yCoordinates),
  )
  return Math.max(diagonal, 1) * 2
}

export const getLayerAwareConnectionPointWeight = ({
  firstPoint,
  secondPoint,
  layerChangePenalty,
}: LayerAwareConnectionPointWeightParams): number =>
  getPlanarDistance(firstPoint, secondPoint) +
  (connectionPointsShareLayer(firstPoint, secondPoint)
    ? 0
    : layerChangePenalty)

const getClosestCrossLayerEdge = (
  firstLayerPoints: ConnectionPoint[],
  secondLayerPoints: ConnectionPoint[],
): Edge<ConnectionPoint> | undefined => {
  let closestEdge: Edge<ConnectionPoint> | undefined

  for (const firstPoint of firstLayerPoints) {
    for (const secondPoint of secondLayerPoints) {
      if (
        firstPoint === secondPoint ||
        connectionPointsShareLayer(firstPoint, secondPoint)
      ) {
        continue
      }
      const distance = getPlanarDistance(firstPoint, secondPoint)
      if (closestEdge && closestEdge.weight <= distance) continue
      closestEdge = { from: firstPoint, to: secondPoint, weight: distance }
    }
  }

  return closestEdge
}

const getCrossLayerEdges = (
  layerPointGroups: ConnectionPoint[][],
  layerChangePenalty: number,
): Edge<ConnectionPoint>[] => {
  const crossLayerEdges: Edge<ConnectionPoint>[] = []

  for (
    let firstLayerIndex = 0;
    firstLayerIndex < layerPointGroups.length;
    firstLayerIndex += 1
  ) {
    for (
      let secondLayerIndex = firstLayerIndex + 1;
      secondLayerIndex < layerPointGroups.length;
      secondLayerIndex += 1
    ) {
      const closestEdge = getClosestCrossLayerEdge(
        layerPointGroups[firstLayerIndex]!,
        layerPointGroups[secondLayerIndex]!,
      )
      if (!closestEdge) continue
      crossLayerEdges.push({
        ...closestEdge,
        weight: closestEdge.weight + layerChangePenalty,
      })
    }
  }

  return crossLayerEdges
}

/**
 * Builds planar trees before joining their layers. This prevents staggered
 * top/bottom pads from creating a via for every short XY edge.
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

  const layerPointGroups = [...pointsByLayer.values()]
  const sameLayerEdges = layerPointGroups.flatMap((layerPoints) =>
    buildMinimumSpanningTree(layerPoints),
  )
  const crossLayerEdges = getCrossLayerEdges(
    layerPointGroups,
    layerChangePenalty,
  )

  return buildMinimumSpanningTree(points, {
    extraEdges: [...extraEdges, ...sameLayerEdges, ...crossLayerEdges],
    getEdgeWeight: ({ from, to, distance }) =>
      getLayerAwareConnectionPointWeight({
        firstPoint: from,
        secondPoint: to,
        layerChangePenalty,
      }),
  })
}
