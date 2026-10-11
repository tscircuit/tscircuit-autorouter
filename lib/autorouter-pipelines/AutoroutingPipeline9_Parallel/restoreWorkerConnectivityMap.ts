import { ConnectivityMap } from "circuit-json-to-connectivity-map"

export type WorkerConnectivityMapSnapshot = {
  connectivityNetMap: Record<string, string[]>
  connectivityIdToNetMap: Record<string, string>
}

/** Preserve canonical net identities after previously separate nets were merged. */
export function restoreWorkerConnectivityMap(
  snapshot: WorkerConnectivityMapSnapshot,
): ConnectivityMap {
  const connMap = new ConnectivityMap(snapshot.connectivityNetMap)
  // Constructor reconstruction selects the last duplicate member. A merged
  // coordinator map can retain the first net as that member's canonical ID.
  connMap.idToNetMap = structuredClone(snapshot.connectivityIdToNetMap)
  return connMap
}
