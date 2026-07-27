import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"

const getConnectionAliases = (connection: SimpleRouteConnection): string[] =>
  [
    connection.name,
    connection.__netConnectionName,
    ...(connection.__rootConnectionNames ?? []),
  ].filter((alias): alias is string => Boolean(alias))

const getDefaultCanonicalConnectionName = (
  connection: SimpleRouteConnection,
): string =>
  connection.__netConnectionName ??
  connection.__rootConnectionNames?.[0] ??
  connection.name

const chooseCanonicalConnectionName = (
  members: SimpleRouteConnection[],
): string => {
  const explicitNetNames = [
    ...new Set(
      members.flatMap((connection) =>
        connection.__netConnectionName ? [connection.__netConnectionName] : [],
      ),
    ),
  ]
  if (explicitNetNames.length === 1) return explicitNetNames[0]!

  // A full-net connection normally contains every terminal while individual
  // source-trace aliases contain only two. Prefer that physical net
  // definition, retaining input order as the deterministic tie-breaker.
  return members.reduce((best, connection) =>
    connection.pointsToConnect.length > best.pointsToConnect.length
      ? connection
      : best,
  ).name
}

/**
 * Maps every explicitly connected input alias to one canonical physical net.
 *
 * Only the original SRJ's shared-terminal connectivity is authoritative.
 * Point-pair names are intentionally excluded so an unrelated fixed trace
 * named like `route_mst0` cannot be claimed by a generated point pair.
 */
export const getCanonicalConnectionNameMap = (
  srj: Pick<SimpleRouteJson, "connections">,
): Map<string, string> => {
  const connections = srj.connections
  const parentByConnectionIndex = connections.map((_, index) => index)
  const findRoot = (connectionIndex: number): number => {
    const parent = parentByConnectionIndex[connectionIndex] ?? connectionIndex
    if (parent === connectionIndex) return connectionIndex
    const root = findRoot(parent)
    parentByConnectionIndex[connectionIndex] = root
    return root
  }
  const union = (leftIndex: number, rightIndex: number) => {
    const leftRoot = findRoot(leftIndex)
    const rightRoot = findRoot(rightIndex)
    if (leftRoot !== rightRoot) {
      parentByConnectionIndex[rightRoot] = leftRoot
    }
  }
  const connectionIndexesByExplicitIdentity = new Map<string, number[]>()
  for (const [connectionIndex, connection] of connections.entries()) {
    const explicitIdentities = new Set([
      connection.__netConnectionName,
      ...(connection.__rootConnectionNames ?? []),
      ...connection.pointsToConnect.flatMap((point) => [
        point.pointId,
        point.pcb_port_id,
      ]),
    ])
    for (const identity of explicitIdentities) {
      if (!identity) continue
      const indexes = connectionIndexesByExplicitIdentity.get(identity) ?? []
      indexes.push(connectionIndex)
      connectionIndexesByExplicitIdentity.set(identity, indexes)
    }
  }
  for (const indexes of connectionIndexesByExplicitIdentity.values()) {
    const firstIndex = indexes[0]
    if (firstIndex === undefined) continue
    for (const connectionIndex of indexes.slice(1)) {
      union(firstIndex, connectionIndex)
    }
  }

  const membersByRoot = new Map<number, SimpleRouteConnection[]>()
  for (const [connectionIndex, connection] of connections.entries()) {
    const root = findRoot(connectionIndex)
    const members = membersByRoot.get(root) ?? []
    members.push(connection)
    membersByRoot.set(root, members)
  }

  const canonicalNameByAlias = new Map<string, string>()
  for (const members of membersByRoot.values()) {
    const canonicalName = chooseCanonicalConnectionName(members)
    for (const connection of members) {
      for (const alias of getConnectionAliases(connection)) {
        canonicalNameByAlias.set(alias, canonicalName)
      }
    }
  }
  return canonicalNameByAlias
}

export const getCanonicalConnectionName = (
  connection: SimpleRouteConnection,
  canonicalNameByAlias: ReadonlyMap<string, string>,
): string => {
  for (const alias of [
    connection.__netConnectionName,
    ...(connection.__rootConnectionNames ?? []),
    connection.name,
  ]) {
    if (!alias) continue
    const canonicalName = canonicalNameByAlias.get(alias)
    if (canonicalName) return canonicalName
  }
  return getDefaultCanonicalConnectionName(connection)
}
