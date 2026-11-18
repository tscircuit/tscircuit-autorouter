import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import { getMinDistBetweenEnteringPoints } from "lib/utils/getMinDistBetweenEnteringPoints"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

export type IntraNodeConnectionPoint = { x: number; y: number; z: number }

export type PrecomputedIntraNodeRouteParams = {
  connectionPointsByName: ReadonlyMap<
    string,
    readonly IntraNodeConnectionPoint[]
  >
  rootConnectionNameByConnectionName: ReadonlyMap<string, string>
  minDistBetweenEnteringPoints: number
  padObstacles: (Obstacle & { __zLayers: number[] })[]
}

/** Fixed topology and pads are shared within one portfolio attempt. */
export const precomputeIntraNodeRouteParams = ({
  nodeWithPortPoints,
  obstacles = [],
  traceWidth = 0.15,
  viaDiameter = 0.3,
  layerCount = 2,
  obstacleMargin = 0.15,
}: {
  nodeWithPortPoints: NodeWithPortPoints
  obstacles?: Obstacle[]
  traceWidth?: number
  viaDiameter?: number
  layerCount?: number
  obstacleMargin?: number
}): PrecomputedIntraNodeRouteParams => {
  const connectionPointsByName = new Map<string, IntraNodeConnectionPoint[]>()
  const rootConnectionNameByConnectionName = new Map<string, string>()
  const seenPointsByConnectionName = new Map<string, Set<string>>()
  for (const {
    connectionName,
    rootConnectionName,
    x,
    y,
    z,
  } of nodeWithPortPoints.portPoints) {
    if (rootConnectionName) {
      rootConnectionNameByConnectionName.set(connectionName, rootConnectionName)
    }
    let points = connectionPointsByName.get(connectionName)
    let seenPoints = seenPointsByConnectionName.get(connectionName)
    if (!points || !seenPoints) {
      points = []
      seenPoints = new Set()
      connectionPointsByName.set(connectionName, points)
      seenPointsByConnectionName.set(connectionName, seenPoints)
    }
    const layer = z ?? 0
    const key = `${x.toFixed(6)},${y.toFixed(6)},${layer}`
    if (seenPoints.has(key)) continue
    seenPoints.add(key)
    points.push({ x, y, z: layer })
  }
  const bounds = getBoundsFromNodeWithPortPoints(nodeWithPortPoints)
  const copperReach = Math.max(traceWidth, viaDiameter) / 2 + obstacleMargin
  const padObstacles = obstacles
    .filter((obstacle) => {
      if (!obstacle.componentId || obstacle.isFanoutSourceKeepout)
        return false
      let halfWidth = obstacle.width / 2
      let halfHeight = obstacle.height / 2
      if (obstacle.ccwRotationDegrees) {
        // A diagonal bound conservatively covers every rotation.
        const diagonalRadius = Math.hypot(obstacle.width, obstacle.height) / 2
        halfWidth = diagonalRadius
        halfHeight = diagonalRadius
      }
      return (
        obstacle.center.x + halfWidth + copperReach >= bounds.minX &&
        obstacle.center.x - halfWidth - copperReach <= bounds.maxX &&
        obstacle.center.y + halfHeight + copperReach >= bounds.minY &&
        obstacle.center.y - halfHeight - copperReach <= bounds.maxY
      )
    })
    .map((obstacle) => ({
      ...obstacle,
      __zLayers:
        obstacle.__zLayers ??
        obstacle.zLayers ??
        obstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount)),
    }))
  return {
    connectionPointsByName,
    rootConnectionNameByConnectionName,
    minDistBetweenEnteringPoints:
      getMinDistBetweenEnteringPoints(nodeWithPortPoints),
    padObstacles,
  }
}
