import type { CompiledRoutingRules } from "./types"

export function areConnectionNamesElectricallyConnected({
  compiledRules,
  firstConnectionName,
  secondConnectionName,
}: {
  compiledRules: CompiledRoutingRules
  firstConnectionName: string
  secondConnectionName: string
}): boolean {
  if (firstConnectionName === secondConnectionName) return true
  const firstConnection = compiledRules.connections.find(
    (connection) => connection.connectionName === firstConnectionName,
  )
  return (
    firstConnection?.electricallyConnectedConnectionNames.includes(
      secondConnectionName,
    ) ?? false
  )
}

export function getElectricallyConnectedConnectionNames({
  compiledRules,
  connectionName,
}: {
  compiledRules: CompiledRoutingRules
  connectionName: string
}): readonly string[] {
  return (
    compiledRules.connections.find(
      (connection) => connection.connectionName === connectionName,
    )?.electricallyConnectedConnectionNames ?? []
  )
}
