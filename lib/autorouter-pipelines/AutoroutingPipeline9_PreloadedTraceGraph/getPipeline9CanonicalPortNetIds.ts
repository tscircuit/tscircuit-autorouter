import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

/** Resolve generated route aliases through their recorded electrical root. */
export const getPipeline9CanonicalPortNetIds = (
  nodes: readonly NodeWithPortPoints[],
  connMap: ConnectivityMap,
): ReadonlyMap<string, string> => {
  const canonicalNetIdByConnectionName = new Map<string, string>()
  for (const node of nodes) {
    for (const port of [
      ...node.portPoints,
      ...(node.portPointsInPairs ?? []).flat(),
    ]) {
      const identities = [port.connectionName]
      if (port.rootConnectionName !== undefined) {
        identities.push(port.rootConnectionName)
      }
      const canonicalIds = new Set<string>()
      for (const identity of identities) {
        const canonicalId = Object.hasOwn(connMap.netMap, identity)
          ? identity
          : connMap.getNetConnectedToId(identity)
        if (canonicalId !== undefined) canonicalIds.add(canonicalId)
      }
      if (canonicalIds.size !== 1) {
        throw new Error(
          `Pipeline9 port "${port.portPointId}" on "${port.connectionName}" requires one known electrical net`,
        )
      }
      const canonicalId = [...canonicalIds][0]!
      const previous = canonicalNetIdByConnectionName.get(port.connectionName)
      if (previous !== undefined && previous !== canonicalId) {
        throw new Error(
          `Pipeline9 route "${port.connectionName}" has conflicting port nets`,
        )
      }
      canonicalNetIdByConnectionName.set(port.connectionName, canonicalId)
    }
  }
  return canonicalNetIdByConnectionName
}
