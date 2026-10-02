import type { DifferentialPair, SimpleRouteConnection } from "lib/types"

export function getDifferentialPairPointPairError({
  differentialPairs,
  connections,
}: {
  differentialPairs: DifferentialPair[]
  connections: SimpleRouteConnection[]
}): string | null {
  for (const pair of differentialPairs) {
    for (const connectionName of pair.connectionNames) {
      const matchingConnections = connections.filter(
        (connection) =>
          connection.name === connectionName ||
          connection.__rootConnectionNames?.includes(connectionName) ||
          connection.__netConnectionName === connectionName,
      )
      if (matchingConnections.length === 1) continue
      return `Differential pair connection "${connectionName}" resolves to ${matchingConnections.length} point-pair connections; exactly one is supported. Declare each constrained point-to-point segment as a separate differential pair.`
    }
  }
  return null
}
