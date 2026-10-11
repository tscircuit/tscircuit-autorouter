/**
 * Preserve circuit-json-to-connectivity-map 0.0.19's ordered Set unions and
 * creation/deletion net counter. Index membership instead of scanning every
 * surviving network for each ID. This constructs a fresh graph on every call.
 */
export function findOrderedIndexedConnectedNetworks(
  connections: string[][],
): Record<string, string[]> {
  const networks = new Map<string, Set<string>>()
  const networkByNode = new Map<string, Set<string>>()
  const nameByNetwork = new Map<Set<string>, string>()
  let netCounter = 0
  const getOrCreateNetwork = (nodeId: string): Set<string> => {
    const existing = networkByNode.get(nodeId)
    if (existing) return existing
    const network = new Set<string>()
    const name = `connectivity_net${netCounter++}`
    networks.set(name, network)
    nameByNetwork.set(network, name)
    return network
  }
  for (const connection of connections) {
    let network: Set<string> | null = null
    for (const nodeId of connection) {
      if (!network) network = getOrCreateNetwork(nodeId)
      else if (!network.has(nodeId)) {
        const other = getOrCreateNetwork(nodeId)
        if (other !== network) {
          for (const member of other) {
            network.add(member)
            networkByNode.set(member, network)
          }
          networks.delete(nameByNetwork.get(other)!)
          nameByNetwork.delete(other)
        }
      }
      network.add(nodeId)
      networkByNode.set(nodeId, network)
    }
  }
  return Object.fromEntries([...networks].map(([name, members]) =>
    [name, [...members]]))
}
