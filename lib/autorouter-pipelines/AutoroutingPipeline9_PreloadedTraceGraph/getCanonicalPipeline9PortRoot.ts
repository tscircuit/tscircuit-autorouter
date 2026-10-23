import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { PortPoint } from "lib/types/high-density-types"

export function getCanonicalPipeline9PortRoot(port: Pick<PortPoint, "connectionName" | "rootConnectionName" | "portPointId">, connMap: ConnectivityMap): string {
  const connectionRoot = connMap.getNetConnectedToId(port.connectionName)
  const declaredRoot = port.rootConnectionName
  if (connectionRoot !== undefined) {
    // Canonical net keys may also be ordinary aliases of some other net. The
    // registered connection owns this port; do not reinterpret its exact key.
    if (declaredRoot === undefined || declaredRoot === connectionRoot) return connectionRoot
    // Imported preloads can carry an unregistered descriptive root label.
    // Only a known different owner contradicts the registered connection.
    const declaredOwner = connMap.getNetConnectedToId(declaredRoot) ?? (Object.hasOwn(connMap.netMap, declaredRoot) ? declaredRoot : undefined)
    if (declaredOwner !== undefined && declaredOwner !== connectionRoot) throw new Error(`Pipeline9 port ${port.portPointId ?? port.connectionName} declares a foreign electrical root`)
    return connectionRoot
  }
  if (declaredRoot !== undefined && Object.hasOwn(connMap.netMap, declaredRoot)) return declaredRoot
  return connMap.getNetConnectedToId(declaredRoot ?? port.connectionName) ?? declaredRoot ?? port.connectionName
}
