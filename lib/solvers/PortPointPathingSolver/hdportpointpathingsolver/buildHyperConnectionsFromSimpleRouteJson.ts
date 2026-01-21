import type { Connection } from "@tscircuit/hypergraph"
import type { SimpleRouteJson } from "../../../types"
import type {
  ConnectionPathResult,
  InputNodeWithPortPoints,
} from "../PortPointPathingSolver"
import type { HgRegion } from "./buildHyperGraphFromInputNodes"
import { getConnectionsWithNodes } from "../getConnectionsWithNodes"

/**
 * Build hypergraph connections from a SimpleRouteJson and input nodes.
 */
export function buildHyperConnectionsFromSimpleRouteJson({
  simpleRouteJson,
  inputNodes,
  regionMap,
}: {
  simpleRouteJson: SimpleRouteJson
  inputNodes: InputNodeWithPortPoints[]
  regionMap: Map<string, HgRegion>
}): {
  connections: Connection[]
  connectionsWithResults: ConnectionPathResult[]
} {
  const { unshuffledConnectionsWithResults } = getConnectionsWithNodes(
    simpleRouteJson,
    inputNodes,
  )

  const connections: Connection[] = []

  for (const result of unshuffledConnectionsWithResults) {
    const startRegion = regionMap.get(result.nodeIds[0])
    const endRegion = regionMap.get(result.nodeIds[1])
    if (!startRegion || !endRegion) {
      throw new Error(
        `Missing region for connection "${result.connection.name}"`,
      )
    }
    connections.push({
      connectionId: result.connection.name,
      mutuallyConnectedNetworkId:
        result.connection.rootConnectionName ?? result.connection.name,
      startRegion,
      endRegion,
    })
  }

  return {
    connections,
    connectionsWithResults: unshuffledConnectionsWithResults,
  }
}
