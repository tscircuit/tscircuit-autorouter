import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle, SimpleRouteConnection, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

type Owners = Record<string, string | null>
type IdentityKind = "connection" | "pcb_port" | "point" | "obstacle" | "trace" | "external"

export type Pipeline9DerivedPhysicalRouteAlias = {
  connectionName: string
  parentConnectionName?: string
  parentTraceId?: string
}

export type Pipeline9PhysicalOwnership = {
  connectionOwners: Owners
  aliasOwners: Owners
  obstacleOwners: Owners
  routingNetOwners: Owners
  routingMemberOwners: Owners
  diagnostics: {
    originalComponentCount: number
    duplicateOriginalConnectionNames: string[]
    ambiguousOriginalAliases: string[]
    derivedConnectionCount: number
    derivedTraceCount: number
    derivedRouteAliasCount: number
    unknownDerivedAliases: string[]
    ambiguousDerivedAliases: string[]
    unknownRoutingNetIds: string[]
    ambiguousRoutingNetIds: string[]
    ambiguousRoutingNetComponents: Record<string, string[]>
    resolvedRoutingNetCount: number
  }
}

const identity = (kind: string, value: string): string => {
  if (!kind || !value) {
    throw new Error("Physical ownership identities require a kind and value")
  }
  return JSON.stringify([kind, value])
}

/** Resolve only electrical declarations; coordinates never establish ownership. */
export const getPipeline9PhysicalOwnership = ({
  originalSrj,
  derivedConnections = [],
  derivedTraces = [],
  derivedRouteAliases = [],
  routingConnMap,
}: {
  originalSrj: SimpleRouteJson
  derivedConnections?: SimpleRouteConnection[]
  derivedTraces?: SimplifiedPcbTrace[]
  derivedRouteAliases?: Pipeline9DerivedPhysicalRouteAlias[]
  routingConnMap?: ConnectivityMap
}): Pipeline9PhysicalOwnership => {
  const parent = new Map<string, string>()
  const registry = new Map<string, Set<string>>()
  const connectionCounts = new Map<string, number>()
  for (const connection of originalSrj.connections) {
    connectionCounts.set(connection.name, (connectionCounts.get(connection.name) ?? 0) + 1)
  }
  const duplicates = new Set([...connectionCounts].filter(([, count]) => count > 1).map(([name]) => name))
  const forbidden = new Set([...duplicates].map((name) => identity("connection", name)))
  const add = (node: string): string => {
    if (!parent.has(node)) parent.set(node, node)
    return node
  }
  const find = (node: string): string => {
    let root = node
    while (parent.get(root) !== root) {
      const next = parent.get(root)
      if (next === undefined) throw new Error("Physical ownership identity was not registered")
      root = next
    }
    while (node !== root) {
      const next = parent.get(node)!
      parent.set(node, root)
      node = next
    }
    return root
  }
  const union = (left: string | undefined, right: string | undefined): void => {
    if (!left || !right || forbidden.has(left) || forbidden.has(right)) return
    const a = find(left), b = find(right)
    if (a !== b) parent.set(a < b ? b : a, a < b ? a : b)
  }
  const register = (kind: IdentityKind, value: string | undefined): string | undefined => {
    if (!value) return undefined
    const node = add(identity(kind, value))
    const nodes = registry.get(value) ?? new Set<string>()
    nodes.add(node)
    registry.set(value, nodes)
    return node
  }
  for (const connection of originalSrj.connections) {
    register("connection", connection.name)
    for (const name of connection.__rootConnectionNames ?? []) register("connection", name)
    register("connection", connection.__netConnectionName)
    for (const point of connection.pointsToConnect) {
      register("pcb_port", point.pcb_port_id)
      register("point", point.pointId)
    }
  }
  for (const obstacle of originalSrj.obstacles) register("obstacle", obstacle.obstacleId)
  for (const trace of originalSrj.traces ?? []) {
    register("trace", trace.pcb_trace_id)
    register("connection", trace.connection_name)
  }
  for (const connection of originalSrj.connections) {
    const node = identity("connection", connection.name)
    for (const name of [...(connection.__rootConnectionNames ?? []), connection.__netConnectionName]) {
      if (name) union(node, identity("connection", name))
    }
    for (const point of connection.pointsToConnect) {
      if (point.pcb_port_id) union(node, identity("pcb_port", point.pcb_port_id))
      if (point.pointId) union(node, identity("point", point.pointId))
    }
  }
  const originalReference = (alias: string): string | undefined => {
    const candidates = registry.get(alias)
    if (!candidates) return register("external", alias)
    const roots = new Set([...candidates].filter((node) => !forbidden.has(node)).map(find))
    if (roots.size !== 1 || [...candidates].some((node) => forbidden.has(node))) return undefined
    return [...candidates][0]
  }
  const obstacleAnchors = originalSrj.obstacles.map((obstacle, index) => {
    const anchor = add(identity("original_obstacle", String(index)))
    if (obstacle.obstacleId) union(anchor, identity("obstacle", obstacle.obstacleId))
    for (const alias of [...obstacle.connectedTo, ...(obstacle.offBoardConnectsTo ?? [])]) {
      union(anchor, originalReference(alias))
    }
    return anchor
  })
  for (const [index, trace] of (originalSrj.traces ?? []).entries()) {
    const anchor = add(identity("original_trace", String(index)))
    union(anchor, identity("trace", trace.pcb_trace_id))
    union(anchor, identity("connection", trace.connection_name))
    for (const alias of trace.connectsTo ?? []) union(anchor, originalReference(alias))
  }
  const components = [...new Set([...parent.keys()].filter((node) => !forbidden.has(node)).map(find))].sort()
  const componentOwners = new Map(components.map((root, index) => [root, `physical_component_${index}`]))
  const nodeOwner = (node: string): string | null => {
    if (forbidden.has(node)) return null
    const owner = componentOwners.get(find(node))
    if (owner === undefined) throw new Error("Physical ownership component was not registered")
    return owner
  }
  const aliasOwners: Owners = Object.create(null)
  const connectionOwners: Owners = Object.create(null)
  const typedOwners: Owners = Object.create(null)
  for (const [alias, nodes] of registry) {
    const owners = new Set([...nodes].map(nodeOwner))
    aliasOwners[alias] = owners.size === 1 && !owners.has(null) ? [...owners][0]! : null
    for (const node of nodes) typedOwners[node] = nodeOwner(node)
  }
  for (const [alias, nodes] of registry) {
    const node = identity("connection", alias)
    if (nodes.has(node)) connectionOwners[alias] = nodeOwner(node)
  }
  const originalTypedIdentities = new Set(Object.keys(typedOwners))
  const obstacleOwners: Owners = Object.create(null)
  for (const [index, obstacle] of originalSrj.obstacles.entries()) {
    if (!obstacle.obstacleId) continue
    const owner = nodeOwner(obstacleAnchors[index]!)
    const key = identity("obstacle", obstacle.obstacleId)
    if (Object.hasOwn(obstacleOwners, key) && obstacleOwners[key] !== owner) obstacleOwners[key] = null
    else if (!Object.hasOwn(obstacleOwners, key)) obstacleOwners[key] = owner
  }
  const unknownDerived = new Set<string>()
  const ambiguousDerived = new Set<string>()
  const derivedRegistry = new Map<string, Set<string | null>>()
  const candidates = (references: Array<[string, string | undefined]>): Set<string | null> => {
    const owners = new Set<string | null>()
    for (const [kind, value] of references) {
      if (!value) continue
      const key = kind === "alias" ? value : identity(kind, value)
      const record = kind === "alias" ? aliasOwners : typedOwners
      if (Object.hasOwn(record, key)) owners.add(record[key]!)
    }
    return owners
  }
  const assign = (kind: IdentityKind, alias: string | undefined, owner: string | null): boolean => {
    if (!alias) return false
    const key = identity(kind, alias)
    if (originalTypedIdentities.has(key)) return false
    const previousTypedOwner = typedOwners[key]
    const previousAliasOwner = aliasOwners[alias]
    if (Object.hasOwn(typedOwners, key) && typedOwners[key] !== owner) typedOwners[key] = null
    else if (!Object.hasOwn(typedOwners, key)) typedOwners[key] = owner
    const known = derivedRegistry.get(alias) ?? new Set<string | null>()
    if (Object.hasOwn(aliasOwners, alias)) known.add(aliasOwners[alias]!)
    known.add(owner)
    derivedRegistry.set(alias, known)
    aliasOwners[alias] = known.size === 1 && !known.has(null) ? [...known][0]! : null
    if (kind === "connection") connectionOwners[alias] = typedOwners[key]!
    return previousTypedOwner !== typedOwners[key] || previousAliasOwner !== aliasOwners[alias]
  }
  // Alias declarations may refer to an earlier forest branch or merged parent.
  // Resolve dependencies without allowing derived records to union input nets.
  const pending: Array<{ name: string; references: Array<[string, string | undefined]>; aliases: Array<[IdentityKind, string | undefined]> }> = [
    ...derivedConnections.map((connection) => ({
      name: connection.name,
      references: [
        ["connection", connection.name],
        ...(connection.__rootConnectionNames ?? []).map((name) => ["connection", name]),
        ["connection", connection.__netConnectionName],
        ...connection.pointsToConnect.flatMap((point) => [["pcb_port", point.pcb_port_id], ["point", point.pointId]]),
      ] as Array<[string, string | undefined]>,
      aliases: [["connection", connection.name], ...connection.pointsToConnect.flatMap((point) => [["pcb_port", point.pcb_port_id], ["point", point.pointId]])] as Array<[IdentityKind, string | undefined]>,
    })),
    ...derivedTraces.map((trace) => ({
      name: trace.pcb_trace_id,
      references: [["connection", trace.connection_name], ["trace", trace.__replaces_pcb_trace_id], ...(trace.connectsTo ?? []).map((alias) => ["alias", alias])] as Array<[string, string | undefined]>,
      aliases: [["trace", trace.pcb_trace_id], ["connection", trace.connection_name]] as Array<[IdentityKind, string | undefined]>,
    })),
    ...derivedRouteAliases.map((alias) => ({
      name: alias.connectionName,
      references: [["connection", alias.parentConnectionName], ["trace", alias.parentTraceId]] as Array<[string, string | undefined]>,
      aliases: [["connection", alias.connectionName]] as Array<[IdentityKind, string | undefined]>,
    })),
  ]
  let progress = true
  while (progress) {
    progress = false
    for (const item of pending) {
      const owners = candidates(item.references)
      if (owners.size === 0) continue
      const owner = owners.size === 1 && !owners.has(null) ? [...owners][0]! : null
      for (const [kind, alias] of item.aliases) {
        if (assign(kind, alias, owner)) progress = true
      }
    }
  }
  for (const item of pending) {
    const owners = candidates(item.references)
    if (owners.size === 0) unknownDerived.add(item.name)
    else if (owners.size > 1 || owners.has(null)) ambiguousDerived.add(item.name)
  }
  const routingNetOwners: Owners = Object.create(null)
  const routingMemberOwners: Owners = Object.create(null)
  const unknownRoutingNetIds: string[] = [], ambiguousRoutingNetIds: string[] = []
  const ambiguousRoutingNetComponents: Record<string, string[]> = Object.create(null)
  let resolvedRoutingNetCount = 0
  for (const [net, members] of Object.entries(routingConnMap?.netMap ?? {})) {
    const owners = candidates(members.map((alias) => ["alias", alias]))
    const owner = owners.size === 1 && !owners.has(null) ? [...owners][0]! : null
    routingNetOwners[net] = owner
    if (owners.size === 0) unknownRoutingNetIds.push(net)
    else if (owner === null) {
      ambiguousRoutingNetIds.push(net)
      ambiguousRoutingNetComponents[net] = [...owners].map((value) => value ?? "ambiguous_declared_alias")
    }
    else resolvedRoutingNetCount++
    for (const member of members) routingMemberOwners[member] = owner
  }
  return {
    connectionOwners, aliasOwners, obstacleOwners, routingNetOwners, routingMemberOwners,
    diagnostics: {
      originalComponentCount: components.length,
      duplicateOriginalConnectionNames: [...duplicates],
      ambiguousOriginalAliases: [...registry.keys()].filter((alias) => {
        const owners = new Set([...registry.get(alias)!].map(nodeOwner))
        return owners.size !== 1 || owners.has(null)
      }),
      derivedConnectionCount: derivedConnections.length,
      derivedTraceCount: derivedTraces.length,
      derivedRouteAliasCount: derivedRouteAliases.length,
      unknownDerivedAliases: [...unknownDerived],
      ambiguousDerivedAliases: [...ambiguousDerived],
      unknownRoutingNetIds, ambiguousRoutingNetIds, ambiguousRoutingNetComponents, resolvedRoutingNetCount,
    },
  }
}

export const getPipeline9PhysicalRouteOwner = (
  ownership: Pipeline9PhysicalOwnership,
  route: Pick<HighDensityRoute, "connectionName" | "rootConnectionName">,
): string | undefined => {
  if (Object.hasOwn(ownership.connectionOwners, route.connectionName)) {
    return ownership.connectionOwners[route.connectionName] ?? undefined
  }
  const root = route.rootConnectionName
  if (root !== undefined) {
    if (Object.hasOwn(ownership.connectionOwners, root)) return ownership.connectionOwners[root] ?? undefined
    if (Object.hasOwn(ownership.routingNetOwners, root)) return ownership.routingNetOwners[root] ?? undefined
  }
  return Object.hasOwn(ownership.routingMemberOwners, route.connectionName)
    ? ownership.routingMemberOwners[route.connectionName] ?? undefined
    : undefined
}

export const getPipeline9PhysicalObstacleOwner = (
  ownership: Pipeline9PhysicalOwnership,
  obstacle: Obstacle,
): string | undefined => {
  const key = obstacle.obstacleId ? identity("obstacle", obstacle.obstacleId) : undefined
  if (key !== undefined && Object.hasOwn(ownership.obstacleOwners, key)) {
    return ownership.obstacleOwners[key] ?? undefined
  }
  const owners = new Set([...obstacle.connectedTo, ...(obstacle.offBoardConnectsTo ?? [])]
    .filter((alias) => Object.hasOwn(ownership.aliasOwners, alias) && ownership.aliasOwners[alias] !== null)
    .map((alias) => ownership.aliasOwners[alias]!))
  return owners.size === 1 ? [...owners][0] ?? undefined : undefined
}
