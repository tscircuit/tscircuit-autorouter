import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { getCanonicalPipeline9PortRoot } from "./getCanonicalPipeline9PortRoot"

/** Canonical route owners and ordinary obstacle aliases occupy distinct namespaces. */
export function isPipeline9ObstacleOwnedByRoute(obstacle: Obstacle, route: Pick<HighDensityRoute, "connectionName" | "rootConnectionName">, connMap: ConnectivityMap): boolean {
  const owner = getCanonicalPipeline9PortRoot(route, connMap)
  return obstacle.connectedTo.some((id) => {
    const registeredOwner = connMap.getNetConnectedToId(id)
    // A known alias is authoritative, including one whose text also happens
    // to be another canonical key. Raw root equality cannot override it.
    if (registeredOwner !== undefined) return registeredOwner === owner
    // An unregistered exact connection or non-aliased canonical key remains
    // an explicit ownership witness. Ambiguous aliases never reach this case.
    return id === route.connectionName || id === owner
  })
}
