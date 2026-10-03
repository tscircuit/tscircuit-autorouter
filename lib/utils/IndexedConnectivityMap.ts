import { ConnectivityMap } from "circuit-json-to-connectivity-map"

/** Keeps repeated routing queries off the large, sparsely queried id object. */
export class IndexedConnectivityMap extends ConnectivityMap {
  private netById: Map<string, string | null> | undefined

  override addConnections(connections: string[][]): void {
    super.addConnections(connections)
    // Merging nets can change existing ids as well as add new ones. Rebuild
    // lazily after a batch of additions, before the next connectivity query.
    this.netById = undefined
  }

  override getNetConnectedToId(id: string): string | undefined {
    if (!this.netById) {
      this.netById = new Map(Object.entries(this.idToNetMap))
    }
    const indexedNet = this.netById.get(id)
    if (indexedNet !== undefined) return indexedNet ?? undefined
    // Preserve the reference object's lookup semantics, including inherited
    // names, while also caching repeatedly queried ids that have no net.
    const net = this.idToNetMap[id]
    this.netById.set(id, net ?? null)
    return net
  }
}
