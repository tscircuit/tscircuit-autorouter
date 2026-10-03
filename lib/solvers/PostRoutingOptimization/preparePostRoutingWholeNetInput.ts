import type { SimpleRouteJson, SimplifiedPcbTraces } from "../../types"
import type { PostRoutingOptimizationInput } from "./optimizePostRouting"

type Connection = SimpleRouteJson["connections"][number]
const connectionAliases = (c: Connection): string[] =>
  [
    c.name,
    c.source_trace_id,
    c.rootConnectionName,
    c.netConnectionName,
    c.__netConnectionName,
    ...(c.mergedConnectionNames ?? []),
    ...(c.__rootConnectionNames ?? []),
  ].filter((id): id is string => Boolean(id))
const explicitIds = (c: Connection): string[] => [
  ...connectionAliases(c),
  ...c.pointsToConnect
    .flatMap((p) => [p.pointId, p.pcb_port_id])
    .filter((id): id is string => Boolean(id)),
]

/** Consolidates point-pair records by explicit electrical identities only.
 * Coordinates, name prefixes and opaque obstacle alias lists never join nets.
 * The Pipeline9 board and copper stay untouched; this is an isolated phase input.
 */
export function preparePostRoutingWholeNetInput(
  original: SimpleRouteJson,
  traces: SimplifiedPcbTraces,
  fixedTraces: SimplifiedPcbTraces,
  selectedNets: string[],
  routedConnections: Connection[] = [],
): PostRoutingOptimizationInput {
  const connections = structuredClone(original.connections)
  const parent = connections.map((_, i) => i)
  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i]!
    return i
  }
  const declared = new Map<string, number>()
  for (const [i, c] of connections.entries())
    for (const id of explicitIds(c)) {
      if (declared.has(id)) parent[root(i)] = root(declared.get(id)!)
      else declared.set(id, i)
    }
  const groups = new Map<number, Connection[]>()
  for (const [i, c] of connections.entries()) {
    const key = root(i)
    groups.set(key, [...(groups.get(key) ?? []), c])
  }
  const owners = new Map<string, string>()
  const wholeNets: Connection[] = []
  for (const members of groups.values()) {
    if (
      members.some((c) =>
        c.pointsToConnect.some((p) => "terminalVia" in p && p.terminalVia),
      )
    )
      throw new Error("Unsupported terminal constraint in whole-net adapter")
    const requested = members.filter((c) => selectedNets.includes(c.name))
    if (requested.length > 1)
      throw new Error(
        "Post-routing plans select the same explicit whole net twice",
      )
    const representative = requested[0] ?? members[0]!
    const declaredNets = new Set(
      members
        .flatMap((c) => [c.netConnectionName, c.__netConnectionName])
        .filter(Boolean),
    )
    if (declaredNets.size > 1)
      throw new Error(
        "Conflicting declared whole-net identities on one physical port",
      )
    const widths = new Set(
      members.map(
        (c) =>
          c.nominalTraceWidth ??
          c.width ??
          original.nominalTraceWidth ??
          original.minTraceWidth,
      ),
    )
    if (widths.size > 1)
      throw new Error(
        "Post-routing whole-net adapter requires consistent branch width rules",
      )
    const points: Connection["pointsToConnect"] = []
    const pointById = new Map<string, Connection["pointsToConnect"][number]>()
    for (const c of members)
      for (const p of c.pointsToConnect) {
        const ids = [p.pointId, p.pcb_port_id].filter((id): id is string =>
          Boolean(id),
        )
        const prior = ids
          .map((id) => pointById.get(id))
          .filter((point): point is Connection["pointsToConnect"][number] =>
            Boolean(point),
          )
        const existing = prior[0]
        for (const previous of prior) {
          const layers = (p.layers ?? [p.layer]).slice().sort()
          const priorLayers = (previous.layers ?? [previous.layer])
            .slice()
            .sort()
          if (
            p.x !== previous.x ||
            p.y !== previous.y ||
            JSON.stringify(layers) !== JSON.stringify(priorLayers)
          )
            throw new Error(
              "Conflicting geometry/layers for one explicit physical port",
            )
        }
        if (!existing) points.push(p)
        for (const id of ids) pointById.set(id, existing ?? p)
      }
    wholeNets.push({
      ...representative,
      __rootConnectionNames: Array.from(
        new Set(members.flatMap(connectionAliases)),
      ),
      pointsToConnect: points,
      isOffBoard: members.some((c) => c.isOffBoard) || undefined,
      externallyConnectedPointIds: members.flatMap(
        (c) => c.externallyConnectedPointIds ?? [],
      ),
    })
    for (const c of members)
      for (const id of explicitIds(c)) owners.set(id, representative.name)
  }
  // A generated router alias must resolve through original explicit roots/ports.
  // Never infer its owner from a coordinate or a connection-name substring.
  for (const c of routedConnections) {
    const matched = new Set(
      explicitIds(c)
        .map((id) => owners.get(id))
        .filter(Boolean),
    )
    if (matched.size !== 1) continue
    const owner = [...matched][0]!
    for (const id of explicitIds(c)) {
      if (owners.has(id) && owners.get(id) !== owner)
        throw new Error(`Conflicting routed alias ${id}`)
      owners.set(id, owner)
    }
  }
  const traceOwners = new Map<string, string>()
  for (const trace of traces) {
    const matched = new Set(
      [trace.connection_name, ...(trace.connectsTo ?? [])]
        .map((id) => owners.get(id))
        .filter((owner): owner is string => Boolean(owner)),
    )
    if (matched.size !== 1)
      throw new Error(
        `Post-routing trace ${trace.pcb_trace_id} needs one explicit whole-net owner, found ${matched.size}`,
      )
    const owner = [...matched][0]!
    if (
      traceOwners.has(trace.connection_name) &&
      traceOwners.get(trace.connection_name) !== owner
    )
      throw new Error(`Conflicting post-routing owner ${trace.connection_name}`)
    traceOwners.set(trace.connection_name, owner)
  }
  return {
    srj: {
      ...structuredClone(original),
      connections: wholeNets,
      traces: structuredClone(fixedTraces),
    },
    traces: structuredClone(traces),
    traceOwners,
  }
}
