import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { DEFAULT_MAX_GROWTH_ATTEMPTS } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"

const MAX_PIPELINE9_ORDINARY_NODE_SCALE =
  2 ** DEFAULT_MAX_GROWTH_ATTEMPTS
const OBSTACLE_OVERLAP_TOLERANCE = 1e-6

export type Pipeline9OrdinaryHighDensityProjection = {
  connectivityNetMap: Record<string, string[]>
  colorMap: Record<string, string>
  obstacles: Obstacle[]
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
  const nodeBounds = getBoundsFromNodeWithPortPoints(nodeWithPortPoints)
  const clearance =
    obstacleMargin +
    Math.max(traceWidth, viaDiameter) / 2 +
    OBSTACLE_OVERLAP_TOLERANCE
  const grownNodeBounds = {
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
  const nodeConnectionNames = [
    ...new Set(
      nodeWithPortPoints.portPoints.map(
        (portPoint) => portPoint.connectionName,
      ),
    ),
  ]

  const projectedObstacles = obstacles.flatMap((obstacle) => {
    const rotationRadians =
      ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
    const cos = Math.abs(Math.cos(rotationRadians))
    const sin = Math.abs(Math.sin(rotationRadians))
    const rawHalfWidth = obstacle.width / 2
    const rawHalfHeight = obstacle.height / 2
    const halfWidth = Math.max(
      rawHalfWidth,
      rawHalfWidth * cos + rawHalfHeight * sin,
    )
    const halfHeight = Math.max(
      rawHalfHeight,
      rawHalfWidth * sin + rawHalfHeight * cos,
    )
    const overlapsMaximumNodeEnvelope =
      obstacle.center.x - halfWidth <= grownNodeBounds.maxX &&
      obstacle.center.x + halfWidth >= grownNodeBounds.minX &&
      obstacle.center.y - halfHeight <= grownNodeBounds.maxY &&
      obstacle.center.y + halfHeight >= grownNodeBounds.minY
    if (!overlapsMaximumNodeEnvelope) return []

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
      {
        type: "rect" as const,
        layers: obstacle.layers,
        ...(obstacle.zLayers === undefined
          ? {}
          : { zLayers: obstacle.zLayers }),
        ...(obstacle.__zLayers === undefined
          ? {}
          : { __zLayers: obstacle.__zLayers }),
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        connectedTo: matchingConnectionNames,
        ...(obstacle.circuitJsonMetadata === undefined
          ? {}
          : { circuitJsonMetadata: obstacle.circuitJsonMetadata }),
      },
    ]
  })

  const relevantIds = new Set<string>()
  const addPortPointIds = (portPoint: PortPoint): void => {
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
  for (const portPoint of nodeWithPortPoints.portPoints) {
    addPortPointIds(portPoint)
  }
  for (const pair of nodeWithPortPoints.portPointsInPairs ?? []) {
    addPortPointIds(pair[0])
    addPortPointIds(pair[1])
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

  const connectivityNetMap = Object.fromEntries(
    Object.entries(connMap.netMap).flatMap(([netId, ids]) => {
      const relevantConnectedIds = ids.filter((id) => relevantIds.has(id))
      return relevantConnectedIds.length > 0 || relevantIds.has(netId)
        ? [[netId, relevantConnectedIds]]
        : []
    }),
  )
  const projectedColorMap = Object.fromEntries(
    Object.entries(colorMap ?? {}).filter(([id]) => relevantIds.has(id)),
  )

  return {
    connectivityNetMap,
    colorMap: projectedColorMap,
    obstacles: projectedObstacles,
  }
}
