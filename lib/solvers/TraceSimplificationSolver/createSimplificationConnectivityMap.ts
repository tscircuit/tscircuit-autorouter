import { ConnectivityMap } from "circuit-json-to-connectivity-map"

export const createSimplificationConnectivityMap = (
  connMap: ConnectivityMap,
  netByConnectionName: ReadonlyMap<string, string> | undefined,
): ConnectivityMap => {
  if (!netByConnectionName?.size) return connMap

  // Copy canonical ID memberships: netMap can also retain aliases of merged
  // nets, which must not become separate nets when registering local routes.
  const netMap: Record<string, string[]> = {}
  for (const [id, netName] of Object.entries(connMap.idToNetMap)) {
    netMap[netName] ??= []
    netMap[netName].push(id)
  }

  for (const [connectionName, declaredNetName] of netByConnectionName) {
    const declaredNetMembers: string[] | undefined =
      connMap.netMap[declaredNetName]
    const netName: string | undefined = declaredNetMembers?.length
      ? connMap.getNetConnectedToId(declaredNetMembers[0]!)
      : declaredNetName
    if (netName === undefined) {
      throw new Error(
        `TraceSimplificationSolver net "${declaredNetName}" has an unregistered member`,
      )
    }
    const existingNetName: string | undefined =
      connMap.getNetConnectedToId(connectionName)
    if (existingNetName !== undefined && existingNetName !== netName) {
      throw new Error(
        `TraceSimplificationSolver route "${connectionName}" belongs to "${existingNetName}", not declared net "${netName}"`,
      )
    }
    if (existingNetName === undefined) {
      netMap[netName] ??= []
      netMap[netName].push(connectionName)
    }
  }

  return new ConnectivityMap(netMap)
}
