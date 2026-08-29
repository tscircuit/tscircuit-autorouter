import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { DEFAULT_MAX_GROWTH_ATTEMPTS } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"

const MAX_PIPELINE9_ORDINARY_NODE_SCALE = 2 ** DEFAULT_MAX_GROWTH_ATTEMPTS
const OBSTACLE_OVERLAP_TOLERANCE = 1e-6

export type Pipeline9OrdinaryHighDensityProjection = {
  connectivityNetMap: Record<string, string[]>
  colorMap: Record<string, string>
  obstacles: Obstacle[]
}

export type Pipeline9RegionalHighDensityProjection = {
  connectivityNetMap: Record<string, string[]>
  obstacles: Obstacle[]
}

type Bounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

const getMaximumPipeline9NodeBounds = ({
  nodeWithPortPoints,
  obstacleMargin,
  traceWidth,
  viaDiameter,
}: {
  nodeWithPortPoints: NodeWithPortPoints
  obstacleMargin: number
  traceWidth: number
  viaDiameter: number
}): Bounds => {
  const nodeBounds = getBoundsFromNodeWithPortPoints(nodeWithPortPoints)
  const clearance =
    obstacleMargin +
    Math.max(traceWidth, viaDiameter) / 2 +
    OBSTACLE_OVERLAP_TOLERANCE
  return {
    minX:
      nodeWithPortPoints.center.x +
      (nodeBounds.minX - nodeWithPortPoints.center.x) *
        MAX_PIPELINE9_ORDINARY_NODE_SCALE -
      clearance,
    maxX:
      nodeWithPortPoints.center.x +
      (nodeBounds.maxX - nodeWithPortPoints.center.x) *
        MAX_PIPELINE9_ORDINARY_NODE_SCALE +
      clearance,
    minY:
      nodeWithPortPoints.center.y +
      (nodeBounds.minY - nodeWithPortPoints.center.y) *
        MAX_PIPELINE9_ORDINARY_NODE_SCALE -
      clearance,
    maxY:
      nodeWithPortPoints.center.y +
      (nodeBounds.maxY - nodeWithPortPoints.center.y) *
        MAX_PIPELINE9_ORDINARY_NODE_SCALE +
      clearance,
  }
}

const obstacleOverlapsBounds = (obstacle: Obstacle, bounds: Bounds): boolean => {
  const rotationRadians = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const cos = Math.abs(Math.cos(rotationRadians))
  const sin = Math.abs(Math.sin(rotationRadians))
  const rawHalfWidth = obstacle.width / 2
  const rawHalfHeight = obstacle.height / 2
  // Some Pipeline9 consumers intentionally use the unrotated bounds while
  // others use the rotated rectangle. The larger envelope preserves both.
  const halfWidth = Math.max(
    rawHalfWidth,
    rawHalfWidth * cos + rawHalfHeight * sin,
  )
  const halfHeight = Math.max(
    rawHalfHeight,
    rawHalfWidth * sin + rawHalfHeight * cos,
  )
  return (
    obstacle.center.x - halfWidth <= bounds.maxX &&
    obstacle.center.x + halfWidth >= bounds.minX &&
    obstacle.center.y - halfHeight <= bounds.maxY &&
    obstacle.center.y + halfHeight >= bounds.minY
  )
}

const getNodeConnectionNames = (
  nodeWithPortPoints: NodeWithPortPoints,
): string[] => [
  ...new Set(
    nodeWithPortPoints.portPoints.map(
      (portPoint) => portPoint.connectionName,
    ),
  ),
]

const addPortPointIds = (relevantIds: Set<string>, portPoint: PortPoint): void => {
  for (const id of [
    portPoint.connectionName,
    portPoint.rootConnectionName,
    portPoint.portPointId,
    portPoint.pcb_port_id,
    portPoint.prevPortPointId,
    portPoint.nextPortPointId,
  ]) {
    if (id !== undefined) relevantIds.add(id)
  }
}

const projectConnectivityNetMap = (
  connMap: ConnectivityMap,
  relevantIds: ReadonlySet<string>,
): Record<string, string[]> =>
  Object.fromEntries(
    Object.entries(connMap.netMap).flatMap(([netId, ids]) => {
      const relevantConnectedIds = ids.filter((id) => relevantIds.has(id))
      return relevantConnectedIds.length > 0 || relevantIds.has(netId)
        ? [[netId, relevantConnectedIds]]
        : []
    }),
  )

const getMinimalProjectedObstacle = ({
  obstacle,
  connectedTo,
  preserveRotation,
}: {
  obstacle: Obstacle
  connectedTo: string[]
  preserveRotation: boolean
}): Obstacle => ({
  type: "rect",
  layers: obstacle.layers,
  ...(obstacle.zLayers === undefined ? {} : { zLayers: obstacle.zLayers }),
  ...(obstacle.__zLayers === undefined
    ? {}
    : { __zLayers: obstacle.__zLayers }),
  center: obstacle.center,
  width: obstacle.width,
  height: obstacle.height,
  ...(preserveRotation && obstacle.ccwRotationDegrees !== undefined
    ? { ccwRotationDegrees: obstacle.ccwRotationDegrees }
    : {}),
  connectedTo,
  ...(obstacle.circuitJsonMetadata === undefined
    ? {}
    : { circuitJsonMetadata: obstacle.circuitJsonMetadata }),
})

const getRelevantObstacleConnectionRepresentatives = ({
  obstacle,
  nodeWithPortPoints,
  connMap,
}: {
  obstacle: Obstacle
  nodeWithPortPoints: NodeWithPortPoints
  connMap: ConnectivityMap
}): string[] => {
  const directRouteIds = new Set(
    nodeWithPortPoints.portPoints.flatMap((portPoint) => {
      const rootConnectionName =
        connMap.getNetConnectedToId(
          portPoint.rootConnectionName ?? portPoint.connectionName,
        ) ??
        portPoint.rootConnectionName ??
        portPoint.connectionName
      return [portPoint.connectionName, rootConnectionName]
    }),
  )
  // The repair stage compares these IDs directly, without a ConnectivityMap.
  // Preserve every exact route/root identity so that direct semantics cannot
  // be changed by projection.
  const representatives = new Set(
    obstacle.connectedTo.filter((id) => directRouteIds.has(id)),
  )

  const idsByNet = new Map<string, string[]>()
  for (const routeId of directRouteIds) {
    const netId = connMap.getNetConnectedToId(routeId) ?? routeId
    const routeIds = idsByNet.get(netId) ?? []
    routeIds.push(routeId)
    idsByNet.set(netId, routeIds)
  }

  for (const routeIds of idsByNet.values()) {
    const alreadyRepresented = [...representatives].some((representative) =>
      routeIds.some(
        (routeId) =>
          routeId === representative ||
          connMap.areIdsConnected(routeId, representative),
      ),
    )
    if (alreadyRepresented) continue

    const connectedId = obstacle.connectedTo.find((candidateId) =>
      routeIds.some(
        (routeId) =>
          routeId === candidateId ||
          connMap.areIdsConnected(routeId, candidateId),
      ),
    )
    if (connectedId !== undefined) {
      representatives.add(connectedId)
    }
  }

  return [...representatives]
}

/**
 * Projects the board obstacles observable by the no-fixed-copper regional
 * fallback. Unlike the ordinary projection, foreign obstacles must remain:
 * Pipeline4HighDensityRepairSolver consumes every obstacle near the node.
 *
 * Connection IDs require special care. The route stage uses ConnectivityMap,
 * while the repair stage checks connectionName/rootConnectionName by direct
 * equality. Exact route IDs are therefore preserved, plus at most one alias
 * representative per relevant net for route-stage equivalence.
 */
export function projectPipeline9RegionalHighDensityInput({
  nodeWithPortPoints,
  connMap,
  obstacles,
  obstacleMargin,
  traceWidth,
  viaDiameter,
}: {
  nodeWithPortPoints: NodeWithPortPoints
  connMap: ConnectivityMap
  obstacles: Obstacle[]
  obstacleMargin: number
  traceWidth: number
  viaDiameter: number
}): Pipeline9RegionalHighDensityProjection {
  const maximumNodeBounds = getMaximumPipeline9NodeBounds({
    nodeWithPortPoints,
    obstacleMargin,
    traceWidth,
    viaDiameter,
  })
  const relevantIds = new Set<string>()
  for (const portPoint of nodeWithPortPoints.portPoints) {
    addPortPointIds(relevantIds, portPoint)
  }
  for (const pair of nodeWithPortPoints.portPointsInPairs ?? []) {
    addPortPointIds(relevantIds, pair[0])
    addPortPointIds(relevantIds, pair[1])
  }

  const projectedObstacles = obstacles.flatMap((obstacle) => {
    if (!obstacleOverlapsBounds(obstacle, maximumNodeBounds)) return []
    const connectedTo = getRelevantObstacleConnectionRepresentatives({
      obstacle,
      nodeWithPortPoints,
      connMap,
    })
    for (const id of connectedTo) relevantIds.add(id)
    return [
      getMinimalProjectedObstacle({
        obstacle,
        connectedTo,
        preserveRotation: true,
      }),
    ]
  })

  return {
    connectivityNetMap: projectConnectivityNetMap(connMap, relevantIds),
    obstacles: projectedObstacles,
  }
}

export const mergePipeline9ProjectedConnectivityNetMaps = (
  ...netMaps: Array<Record<string, string[]>>
): Record<string, string[]> => {
  const merged = new Map<string, Set<string>>()
  for (const netMap of netMaps) {
    for (const [netId, ids] of Object.entries(netMap)) {
      const mergedIds = merged.get(netId) ?? new Set<string>()
      for (const id of ids) mergedIds.add(id)
      merged.set(netId, mergedIds)
    }
  }
  return Object.fromEntries(
    [...merged].map(([netId, ids]) => [netId, [...ids]]),
  )
}

/**
 * Reduces board-wide inputs to the information Pipeline9's ordinary node
 * solver can observe. The overlap envelope covers all 1x/2x/4x/8x
 * grow-shrink attempts and both the rotated geometry and the through-obstacle
 * solver's intentionally unrotated containment check.
 */
export function projectPipeline9OrdinaryHighDensityInput({
  nodeWithPortPoints,
  connMap,
  colorMap,
  obstacles,
  obstacleMargin,
  traceWidth,
  viaDiameter,
}: {
  nodeWithPortPoints: NodeWithPortPoints
  connMap: ConnectivityMap
  colorMap?: Record<string, string>
  obstacles: Obstacle[]
  obstacleMargin: number
  traceWidth: number
  viaDiameter: number
}): Pipeline9OrdinaryHighDensityProjection {
  const grownNodeBounds = getMaximumPipeline9NodeBounds({
    nodeWithPortPoints,
    obstacleMargin,
    traceWidth,
    viaDiameter,
  })
  const nodeConnectionNames = getNodeConnectionNames(nodeWithPortPoints)

  const projectedObstacles = obstacles.flatMap((obstacle) => {
    if (!obstacleOverlapsBounds(obstacle, grownNodeBounds)) return []

    const matchingConnectionNames = nodeConnectionNames.filter(
      (connectionName) =>
        obstacle.connectedTo.some(
          (connectedId) =>
            connectedId === connectionName ||
            connMap.areIdsConnected(connectionName, connectedId),
        ),
    )
    if (matchingConnectionNames.length === 0) return []

    return [
      getMinimalProjectedObstacle({
        obstacle,
        connectedTo: matchingConnectionNames,
        preserveRotation: false,
      }),
    ]
  })

  const relevantIds = new Set<string>()
  for (const portPoint of nodeWithPortPoints.portPoints) {
    addPortPointIds(relevantIds, portPoint)
  }
  for (const pair of nodeWithPortPoints.portPointsInPairs ?? []) {
    addPortPointIds(relevantIds, pair[0])
    addPortPointIds(relevantIds, pair[1])
  }
  for (const obstacle of projectedObstacles) {
    for (const id of [
      obstacle.circuitJsonMetadata?.pcb_smtpad_id,
      obstacle.circuitJsonMetadata?.pcb_plated_hole_id,
      obstacle.circuitJsonMetadata?.pcb_port_id,
      obstacle.circuitJsonMetadata?.pcb_via_id,
      ...(obstacle.connectedTo ?? []),
    ]) {
      if (id !== undefined) relevantIds.add(id)
    }
  }

  const connectivityNetMap = projectConnectivityNetMap(connMap, relevantIds)
  const projectedColorMap = Object.fromEntries(
    Object.entries(colorMap ?? {}).filter(([id]) => relevantIds.has(id)),
  )

  return {
    connectivityNetMap,
    colorMap: projectedColorMap,
    obstacles: projectedObstacles,
  }
}
