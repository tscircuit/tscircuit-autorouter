import type {
  CapacityMeshNode,
  Obstacle,
  SimpleRouteConnection,
} from "lib/types"
import {
  getBoundsIntersection,
  getCapacityMeshNodeBounds,
} from "./capacity-node-geometry"
import { getConnectedObstacleFragmentGroups } from "./get-connected-obstacle-fragment-groups"
import { getObstacleFragmentGroupsWithoutRoutingExits } from "./get-obstacle-fragment-groups-without-routing-exits"

type AddConnectionNamesToFragmentedObstacleMeshNodesParams = {
  meshNodes: readonly CapacityMeshNode[]
  obstacles: readonly Obstacle[]
  connections: readonly SimpleRouteConnection[]
  layerCount: number
}

/** Preserves net identity on RectDiff regions made from fragmented copper. */
export function addConnectionNamesToFragmentedObstacleMeshNodes({
  meshNodes,
  obstacles,
  connections,
  layerCount,
}: AddConnectionNamesToFragmentedObstacleMeshNodesParams): CapacityMeshNode[] {
  const fragmentGroups = getConnectedObstacleFragmentGroups({
    obstacles,
    connections,
    layerCount,
  })
  const groupsWithoutRoutingExits =
    getObstacleFragmentGroupsWithoutRoutingExits({
      meshNodes,
      fragmentGroups,
      connections,
      layerCount,
    })

  return meshNodes.map((meshNode) => {
    if (!meshNode._containsObstacle) return meshNode

    const connectionNames = new Set(meshNode._connectedTo ?? [])
    const meshNodeBounds = getCapacityMeshNodeBounds(meshNode)

    for (const group of groupsWithoutRoutingExits) {
      const overlapsFragment = group.fragments.some(
        (fragment) =>
          meshNode.availableZ.some((z) => fragment.zLayers.includes(z)) &&
          getBoundsIntersection(meshNodeBounds, fragment.bounds) !== null,
      )
      if (!overlapsFragment) continue

      for (const connectionName of group.connectionNames) {
        connectionNames.add(connectionName)
      }
    }

    if (connectionNames.size === 0) return meshNode
    return { ...meshNode, _connectedTo: [...connectionNames].sort() }
  })
}
