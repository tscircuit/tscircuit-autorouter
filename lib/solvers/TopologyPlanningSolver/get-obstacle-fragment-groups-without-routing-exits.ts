import type { Bounds } from "@tscircuit/math-utils"
import type {
  CapacityMeshNode,
  ConnectionPoint,
  SimpleRouteConnection,
} from "lib/types"
import { getConnectionPointLayers } from "lib/types"
import { areNodesBordering } from "lib/utils/areNodesBordering"
import { getUniqueValidZLayersFromLayerNames } from "lib/utils/mapLayerNameToZ"
import {
  GEOMETRY_EPSILON,
  getBoundsIntersection,
  getCapacityMeshNodeBounds,
} from "./capacity-node-geometry"
import type { ConnectedObstacleFragmentGroup } from "./get-connected-obstacle-fragment-groups"

const doesBoundsContainPoint = (
  bounds: Bounds,
  point: ConnectionPoint,
): boolean =>
  point.x >= bounds.minX - GEOMETRY_EPSILON &&
  point.x <= bounds.maxX + GEOMETRY_EPSILON &&
  point.y >= bounds.minY - GEOMETRY_EPSILON &&
  point.y <= bounds.maxY + GEOMETRY_EPSILON

const getPointZLayers = (
  point: ConnectionPoint,
  layerCount: number,
): number[] =>
  getUniqueValidZLayersFromLayerNames(
    getConnectionPointLayers(point),
    layerCount,
  )

const isPointInFragmentGroup = (
  point: ConnectionPoint,
  pointZLayers: readonly number[],
  group: ConnectedObstacleFragmentGroup,
): boolean =>
  group.fragments.some(
    (fragment) =>
      pointZLayers.some((z) => fragment.zLayers.includes(z)) &&
      doesBoundsContainPoint(fragment.bounds, point),
  )

const getEndpointObstacleNodes = ({
  meshNodes,
  group,
  point,
  pointZLayers,
}: {
  meshNodes: readonly CapacityMeshNode[]
  group: ConnectedObstacleFragmentGroup
  point: ConnectionPoint
  pointZLayers: readonly number[]
}): CapacityMeshNode[] =>
  meshNodes.filter((meshNode) => {
    if (!meshNode._containsObstacle) return false
    if (!meshNode.availableZ.some((z) => pointZLayers.includes(z))) return false

    const nodeBounds = getCapacityMeshNodeBounds(meshNode)
    if (!doesBoundsContainPoint(nodeBounds, point)) return false
    return group.fragments.some(
      (fragment) =>
        meshNode.availableZ.some((z) => fragment.zLayers.includes(z)) &&
        getBoundsIntersection(nodeBounds, fragment.bounds) !== null,
    )
  })

const hasRoutingExit = (
  endpointNodes: readonly CapacityMeshNode[],
  meshNodes: readonly CapacityMeshNode[],
): boolean =>
  endpointNodes.some((endpointNode) =>
    meshNodes.some(
      (candidateNode) =>
        !candidateNode._containsObstacle &&
        candidateNode.availableZ.some((z) =>
          endpointNode.availableZ.includes(z),
        ) &&
        areNodesBordering(endpointNode, candidateNode),
    ),
  )

/** Returns fragmented copper groups whose terminals are enclosed by the shape. */
export function getObstacleFragmentGroupsWithoutRoutingExits({
  meshNodes,
  fragmentGroups,
  connections,
  layerCount,
}: {
  meshNodes: readonly CapacityMeshNode[]
  fragmentGroups: readonly ConnectedObstacleFragmentGroup[]
  connections: readonly SimpleRouteConnection[]
  layerCount: number
}): ConnectedObstacleFragmentGroup[] {
  return fragmentGroups.filter((group) =>
    connections.some((connection) => {
      const connectionNames = new Set([
        connection.name,
        ...(connection.__rootConnectionNames ?? []),
      ])
      if (!group.connectionNames.some((name) => connectionNames.has(name))) {
        return false
      }

      return connection.pointsToConnect.some((point) => {
        const pointZLayers = getPointZLayers(point, layerCount)
        if (!isPointInFragmentGroup(point, pointZLayers, group)) return false

        const endpointNodes = getEndpointObstacleNodes({
          meshNodes,
          group,
          point,
          pointZLayers,
        })
        return (
          endpointNodes.length > 0 && !hasRoutingExit(endpointNodes, meshNodes)
        )
      })
    }),
  )
}
