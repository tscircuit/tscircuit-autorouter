import { ConnectivityMap } from "circuit-json-to-connectivity-map"

const nativeGetNetConnectedToId = ConnectivityMap.prototype.getNetConnectedToId
const nativeAreIdsConnected = ConnectivityMap.prototype.areIdsConnected

/** Avoids repeated virtual net lookups in routing connectivity checks. */
export class RoutingConnectivityMap extends ConnectivityMap {
  override areIdsConnected(id1: string, id2: string): boolean {
    if (ConnectivityMap.prototype.areIdsConnected !== nativeAreIdsConnected) {
      return super.areIdsConnected(id1, id2)
    }
    if (id1 === id2) return true
    if (this.getNetConnectedToId !== nativeGetNetConnectedToId) {
      return super.areIdsConnected(id1, id2)
    }
    const netId1 = this.idToNetMap[id1]
    if (!netId1) return false
    const netId2 = this.idToNetMap[id2]
    if (!netId2) return false
    // The reference map's net-name alias comparison is directional.
    return netId1 === netId2 || netId2 === id1
  }
}
