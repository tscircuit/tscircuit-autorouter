import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { CapacityMeshNode } from "lib/types/capacity-mesh-types"
import type { Obstacle, SimpleRouteJson } from "lib/types/srj-types"
import {
  getObstacleZLayers,
  getPointToObstacleDistance,
} from "./Pipeline9RegionalFallbackSolver"

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

/** Smallest searched cell edge, in mm. A via center that fits only inside a
 * smaller gap would clear the keep-out by less than this. */
const MIN_SEARCH_CELL_SIZE = 0.005

type KeepOutObstacle = { obstacle: Obstacle; bounds: Bounds }

const isRoutedNetObstacle = (
  obstacle: Obstacle,
  connMap: ConnectivityMap,
  routedNetIds: ReadonlySet<string>,
): boolean =>
  [obstacle.obstacleId, ...obstacle.connectedTo].some((id) => {
    if (!id) return false
    const netId = connMap.getNetConnectedToId(id)
    return netId !== undefined && routedNetIds.has(netId)
  })

/**
 * True when some point of the cell is at least keepOut from every obstacle.
 * Distance to a rectangle (rotated or not) or a circle is convex, so a cell
 * whose four corners all lie closer than keepOut to one obstacle lies inside
 * that obstacle's keep-out entirely. Otherwise the cell is halved along its
 * longer side until a legal point turns up or each part is covered; a part
 * under MIN_SEARCH_CELL_SIZE with no legal corner or center counts as covered.
 */
const hasViaSiteInCell = (
  cell: Bounds,
  obstacles: KeepOutObstacle[],
  keepOut: number,
): boolean => {
  const corners = [
    { x: cell.minX, y: cell.minY },
    { x: cell.maxX, y: cell.minY },
    { x: cell.minX, y: cell.maxY },
    { x: cell.maxX, y: cell.maxY },
  ]
  const center = {
    x: (cell.minX + cell.maxX) / 2,
    y: (cell.minY + cell.maxY) / 2,
  }
  for (const point of [center, ...corners]) {
    if (
      obstacles.every(
        ({ obstacle }) =>
          getPointToObstacleDistance(point, obstacle) >= keepOut,
      )
    )
      return true
  }
  if (
    obstacles.some(({ obstacle }) =>
      corners.every(
        (corner) => getPointToObstacleDistance(corner, obstacle) < keepOut,
      ),
    )
  )
    return false
  const width = cell.maxX - cell.minX
  const height = cell.maxY - cell.minY
  if (Math.max(width, height) <= MIN_SEARCH_CELL_SIZE) return false
  const halves: Bounds[] =
    width >= height
      ? [
          { ...cell, maxX: center.x },
          { ...cell, minX: center.x },
        ]
      : [
          { ...cell, maxY: center.y },
          { ...cell, minY: center.y },
        ]
  return halves.some((half) =>
    hasViaSiteInCell(
      half,
      obstacles.filter(
        ({ bounds }) =>
          bounds.minX - keepOut < half.maxX &&
          bounds.maxX + keepOut > half.minX &&
          bounds.minY - keepOut < half.maxY &&
          bounds.maxY + keepOut > half.minY,
      ),
      keepOut,
    ),
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
 * their own vias may sit beside it. Copper on layers the node does not offer,
 * such as a plane, is left to the stages that already handle vias through it.
 * Component topology nodes, which apply their own via rules, are left
 * unchanged. So are nodes narrower than a via: marking them too (about 2,000
 * nodes on H616) raised H616's full-board DRC findings from 43 to 113, and
 * A13's from 7 to 10. Board coordinates in mm, +X right, +Y up.
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
  const keepOut = viaDiameter / 2 + viaToPadClearance
  const hardObstacles = srj.obstacles
    .filter((obstacle) => !isRoutedNetObstacle(obstacle, connMap, routedNetIds))
    .map((obstacle) => ({
      obstacle,
      bounds: getObstacleBounds(obstacle),
      zLayers: getObstacleZLayers(obstacle, srj.layerCount),
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
    if (centers.minX > centers.maxX || centers.minY > centers.maxY) return node
    const nearby = hardObstacles.filter(
      ({ bounds, zLayers }) =>
        zLayers.some((z) => node.availableZ.includes(z)) &&
        bounds.minX - keepOut < centers.maxX &&
        bounds.maxX + keepOut > centers.minX &&
        bounds.minY - keepOut < centers.maxY &&
        bounds.maxY + keepOut > centers.minY,
    )
    if (nearby.length === 0) return node
    const hasViaSite = hasViaSiteInCell(centers, nearby, keepOut)
    return hasViaSite ? node : { ...node, _lacksViaSite: true }
  })
}
