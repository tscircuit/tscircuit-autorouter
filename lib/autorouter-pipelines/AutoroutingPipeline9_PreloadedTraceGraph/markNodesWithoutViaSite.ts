import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { CapacityMeshNode } from "lib/types/capacity-mesh-types"
import type { Obstacle, SimpleRouteJson } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { getPointToObstacleDistance } from "./Pipeline9RegionalFallbackSolver"

type Bounds = { minX: number; maxX: number; minY: number; maxY: number }
type MarkNodesWithoutViaSiteParams = {
  nodes: CapacityMeshNode[]
  srj: SimpleRouteJson
  connMap: ConnectivityMap
  viaDiameter: number
  viaToPadClearance: number
}

const getObstacleBounds = (obstacle: Obstacle): Bounds => {
  const rotationRadians = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const cos = Math.abs(Math.cos(rotationRadians))
  const sin = Math.abs(Math.sin(rotationRadians))
  const halfWidth = (obstacle.width / 2) * cos + (obstacle.height / 2) * sin
  const halfHeight = (obstacle.width / 2) * sin + (obstacle.height / 2) * cos
  return {
    minX: obstacle.center.x - halfWidth,
    maxX: obstacle.center.x + halfWidth,
    minY: obstacle.center.y - halfHeight,
    maxY: obstacle.center.y + halfHeight,
  }
}

/** Candidate coordinates along one axis of the via-center region: its ends,
 * every obstacle keep-out boundary inside it and the midpoints between them. */
const getAxisSamples = (
  min: number,
  max: number,
  boundaries: number[],
): number[] => {
  const cuts = [
    ...new Set([
      min,
      max,
      ...boundaries.filter((value) => value > min && value < max),
    ]),
  ].sort((a, b) => a - b)
  return cuts.flatMap((cut, index) =>
    index + 1 < cuts.length ? [cut, (cut + cuts[index + 1]!) / 2] : [cut],
  )
}

/**
 * Mark free-space nodes that can hold a via but have no legal place for one,
 * so path planning prices a layer change there far above its area cost.
 *
 * Global free-space nodes may border copper directly, and the high-density
 * solvers keep a via inside its node. A node therefore offers a via only where
 * a via center inside it keeps the via-to-pad clearance from the copper of nets
 * this request does not route, such as pads and traces fixed by earlier
 * phases, on the layers the node offers. Copper of nets it routes is skipped:
 * their own vias may sit beside it. Copper on layers the node does not offer, such as a plane, is left to
 * the stages that already handle vias through it. Component topology nodes,
 * which apply their own via rules, and nodes too small for any via are left
 * unchanged. Board coordinates in mm, +X right, +Y up.
 */
export const markNodesWithoutViaSite = ({
  nodes,
  srj,
  connMap,
  viaDiameter,
  viaToPadClearance,
}: MarkNodesWithoutViaSiteParams): CapacityMeshNode[] => {
  const routedNetIds = new Set(
    srj.connections.map(
      (connection) =>
        connMap.getNetConnectedToId(connection.name) ?? connection.name,
    ),
  )
  const isRoutedNetObstacle = (obstacle: Obstacle): boolean =>
    [obstacle.obstacleId, ...obstacle.connectedTo].some((id) => {
      if (!id) return false
      const netId = connMap.getNetConnectedToId(id)
      return netId !== undefined && routedNetIds.has(netId)
    })
  const keepOut = viaDiameter / 2 + viaToPadClearance
  const hardObstacles = srj.obstacles
    .filter((obstacle) => !isRoutedNetObstacle(obstacle))
    .map((obstacle) => ({
      obstacle,
      bounds: getObstacleBounds(obstacle),
      zLayers:
        obstacle.zLayers ??
        obstacle.layers.map((layer) => mapLayerNameToZ(layer, srj.layerCount)),
    }))
  return nodes.map((node): CapacityMeshNode => {
    if (
      node._isComponentTopologyNode ||
      node._containsTarget ||
      node._containsObstacle ||
      node.availableZ.length < 2
    )
      return node
    const centers: Bounds = {
      minX: node.center.x - node.width / 2 + viaDiameter / 2,
      maxX: node.center.x + node.width / 2 - viaDiameter / 2,
      minY: node.center.y - node.height / 2 + viaDiameter / 2,
      maxY: node.center.y + node.height / 2 - viaDiameter / 2,
    }
    if (centers.minX > centers.maxX || centers.minY > centers.maxY)
      return node
    const nearby = hardObstacles.filter(
      ({ bounds, zLayers }) =>
        zLayers.some((z) => node.availableZ.includes(z)) &&
        bounds.minX - keepOut < centers.maxX &&
        bounds.maxX + keepOut > centers.minX &&
        bounds.minY - keepOut < centers.maxY &&
        bounds.maxY + keepOut > centers.minY,
    )
    if (nearby.length === 0) return node
    const xs = getAxisSamples(
      centers.minX,
      centers.maxX,
      nearby.flatMap(({ bounds }) => [
        bounds.minX - keepOut,
        bounds.maxX + keepOut,
      ]),
    )
    const ys = getAxisSamples(
      centers.minY,
      centers.maxY,
      nearby.flatMap(({ bounds }) => [
        bounds.minY - keepOut,
        bounds.maxY + keepOut,
      ]),
    )
    const hasViaSite = xs.some((x) =>
      ys.some((y) =>
        nearby.every(
          ({ obstacle }) =>
            getPointToObstacleDistance({ x, y }, obstacle) >= keepOut,
        ),
      ),
    )
    return hasViaSite ? node : { ...node, _lacksViaSite: true }
  })
}
