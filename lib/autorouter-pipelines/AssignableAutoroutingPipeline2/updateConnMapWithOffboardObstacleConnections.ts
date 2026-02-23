import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson } from "lib/types"

export const updateConnMapWithOffboardObstacleConnections = ({
  connMap,
  connectionsWithResults,
  inputNodes,
  obstacles,
}: {
  connMap: ConnectivityMap
  connectionsWithResults: Array<{
    connection: { name: string; rootConnectionName?: string }
    path?: Array<{ currentNodeId: string; throughNodeId?: string }>
  }>
  inputNodes: Array<{
    capacityMeshNodeId: string
    _offBoardConnectionId?: string
  }>
  obstacles: SimpleRouteJson["obstacles"]
}) => {
  const offBoardObstacles = obstacles.filter(
    (obstacle) => obstacle.offBoardConnectsTo?.length,
  )
  if (offBoardObstacles.length === 0) return

  const offBoardConnMap = new ConnectivityMap({})
  offBoardConnMap.addConnections(
    offBoardObstacles.map((obstacle, index) => {
      const obstacleId = obstacle.obstacleId ?? `__obs${index}`
      return [obstacleId, ...(obstacle.offBoardConnectsTo ?? [])]
    }),
  )

  const nodeMap = new Map(
    inputNodes.map((node) => [node.capacityMeshNodeId, node]),
  )

  for (const connectionResult of connectionsWithResults) {
    if (!connectionResult.path) continue
    const rootConnectionName =
      connectionResult.connection.rootConnectionName ??
      connectionResult.connection.name

    const offBoardNetIds = new Set<string>()

    for (const candidate of connectionResult.path) {
      const node = nodeMap.get(candidate.currentNodeId)
      if (node?._offBoardConnectionId) {
        offBoardNetIds.add(node._offBoardConnectionId)
      }

      if (candidate.throughNodeId) {
        const throughNode = nodeMap.get(candidate.throughNodeId)
        if (throughNode?._offBoardConnectionId) {
          offBoardNetIds.add(throughNode._offBoardConnectionId)
        }
      }
    }

    for (const offBoardNetId of offBoardNetIds) {
      const connectedIds = offBoardConnMap.getIdsConnectedToNet(offBoardNetId)
      if (!connectedIds?.length) continue
      connMap.addConnections([[rootConnectionName, ...connectedIds]])
    }
  }
}
