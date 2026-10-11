import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson } from "../../types"
import { getConnectivityMapFromSimpleRouteJson } from "../../utils/getConnectivityMapFromSimpleRouteJson"

/**
 * Build the native map in its original insertion order. Set membership replaces
 * repeated linear includes() scans, but native net names, duplicate merge
 * entries and shared array aliases remain intact. Published maps use the
 * original ConnectivityMap methods; the construction helper owns all mutation.
 */
export function getParallelConnectivityMap(srj: SimpleRouteJson): ConnectivityMap {
  const map = new ConnectivityMap({})
  const membersByArray = new WeakMap<string[], Set<string>>()
  let netCount = 0

  const getMembers = (ids: string[]): Set<string> => {
    let members = membersByArray.get(ids)
    if (!members) {
      members = new Set(ids)
      membersByArray.set(ids, members)
    }
    return members
  }

  map.addConnections = (connections: string[][]): void => {
    for (const connection of connections) {
      const existingNets = new Set<string>()
      for (const id of connection) {
        const existingNetId = map.idToNetMap[id]
        if (existingNetId) existingNets.add(existingNetId)
      }
      let targetNetId: string
      if (existingNets.size === 0) {
        targetNetId = `connectivity_net${netCount++}`
        map.netMap[targetNetId] = []
      } else {
        targetNetId = existingNets.values().next().value!
        if (existingNets.size > 1) {
          for (const netId of existingNets) {
            if (netId === targetNetId) continue
            const targetIds = map.netMap[targetNetId]!
            const otherIds = map.netMap[netId]!
            const targetMembers = getMembers(targetIds)
            const otherMembers = getMembers(otherIds)
            // Native merging preserves duplicates and only rewrites this alias.
            targetIds.push(...otherIds)
            for (const id of otherMembers) targetMembers.add(id)
            map.netMap[netId] = targetIds
            for (const id of targetIds) map.idToNetMap[id] = targetNetId
          }
        }
      }
      const targetIds = map.netMap[targetNetId]!
      const targetMembers = getMembers(targetIds)
      for (const id of connection) {
        if (!targetMembers.has(id)) {
          targetIds.push(id)
          targetMembers.add(id)
        }
        map.idToNetMap[id] = targetNetId
      }
    }
  }
  getConnectivityMapFromSimpleRouteJson(srj, map)
  // Remove the temporary own method so later additions remain fully native.
  delete (map as Partial<ConnectivityMap>).addConnections
  return map
}
