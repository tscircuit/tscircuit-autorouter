import type {
  SimpleRouteBus,
  SimpleRouteConnection,
  SimplifiedPcbTrace,
} from "lib/types/srj-types"

type ConnectionName = SimpleRouteConnection["name"]
type TraceId = SimplifiedPcbTrace["pcb_trace_id"]

type GetFixedBusConnectionLengthsParams = {
  buses: SimpleRouteBus[]
  connections: SimpleRouteConnection[]
  traces: SimplifiedPcbTrace[]
}

/** Count the current retained copper ledger once per logical bus member. */
export const getFixedBusConnectionLengths = ({
  buses,
  connections,
  traces,
}: GetFixedBusConnectionLengthsParams): Partial<Record<ConnectionName, number>> => {
  const busMembers = new Set(
    buses.flatMap((bus) =>
      bus.maxLengthSkew === undefined ? [] : bus.connectionNames,
    ),
  )
  const membersByAlias = new Map<ConnectionName, Set<ConnectionName>>()
  const connectionAliases = connections.map((connection) =>
    [
      connection.name,
      connection.rootConnectionName,
      connection.netConnectionName,
      connection.__netConnectionName,
      connection.source_trace_id,
      ...(connection.mergedConnectionNames ?? []),
      ...(connection.__rootConnectionNames ?? []),
    ].filter((name): name is ConnectionName => name !== undefined),
  )
  for (const member of busMembers) {
    const aliases = new Set([member])
    let previousSize = -1
    while (aliases.size !== previousSize) {
      previousSize = aliases.size
      for (const connection of connectionAliases) {
        if (!connection.some((alias) => aliases.has(alias))) continue
        for (const alias of connection) aliases.add(alias)
      }
    }
    for (const alias of aliases) {
      let aliasMembers = membersByAlias.get(alias)
      if (!aliasMembers) {
        aliasMembers = new Set()
        membersByAlias.set(alias, aliasMembers)
      }
      aliasMembers.add(member)
    }
  }

  const replacedTraceIds = new Set(
    traces.flatMap((trace) =>
      trace.__replaces_pcb_trace_id !== undefined &&
      trace.__replaces_pcb_trace_id !== trace.pcb_trace_id
        ? [trace.__replaces_pcb_trace_id]
        : [],
    ),
  )
  const countedTraceIds = new Set<TraceId>()
  const lengths = new Map<ConnectionName, number>()
  for (const trace of traces) {
    if (replacedTraceIds.has(trace.pcb_trace_id)) continue
    const members = new Set<ConnectionName>()
    for (const alias of [trace.connection_name, ...(trace.connectsTo ?? [])]) {
      for (const member of membersByAlias.get(alias) ?? []) members.add(member)
    }
    if (members.size === 0) continue
    if (members.size !== 1) {
      throw new Error(
        `Length matching: retained trace "${trace.pcb_trace_id}" belongs to multiple bus members: ${[...members].join(", ")}`,
      )
    }
    if (countedTraceIds.has(trace.pcb_trace_id)) {
      throw new Error(
        `Length matching: duplicate retained trace "${trace.pcb_trace_id}"`,
      )
    }
    countedTraceIds.add(trace.pcb_trace_id)
    const member = [...members][0]!
    const points = trace.route.flatMap((point) =>
      "x" in point ? [{ x: point.x, y: point.y }] : [point.start, point.end],
    )
    const length = points.slice(1).reduce((total, point, index) => {
      const previous = points[index]!
      return total + Math.hypot(point.x - previous.x, point.y - previous.y)
    }, 0)
    lengths.set(member, (lengths.get(member) ?? 0) + length)
  }
  return Object.fromEntries(lengths)
}
