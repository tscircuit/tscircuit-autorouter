import type {
  SimpleRouteConnection,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "lib/types"

const getCanonicalConnectionName = (
  connection: SimpleRouteConnection,
): string =>
  connection.__netConnectionName ??
  connection.__rootConnectionNames?.[0] ??
  connection.name

const getConnectionIdentityIds = (
  connection: SimpleRouteConnection,
): Set<string> =>
  new Set(
    [
      connection.name,
      connection.__netConnectionName,
      ...(connection.__rootConnectionNames ?? []),
      ...connection.pointsToConnect.flatMap((point) => [
        point.pointId,
        point.pcb_port_id,
      ]),
    ].filter((id): id is string => typeof id === "string"),
  )

const getSimplifiedTraceEndpoints = (
  trace: SimplifiedPcbTrace,
): Array<{ x: number; y: number; layers: string[] }> =>
  [
    { routePoint: trace.route[0], endpoint: "start" as const },
    { routePoint: trace.route.at(-1), endpoint: "end" as const },
  ].flatMap(({ routePoint, endpoint }) => {
    if (!routePoint) return []
    if (routePoint.route_type === "wire") {
      return [{ x: routePoint.x, y: routePoint.y, layers: [routePoint.layer] }]
    }
    if (routePoint.route_type === "via") {
      return [
        {
          x: routePoint.x,
          y: routePoint.y,
          layers: [routePoint.from_layer, routePoint.to_layer],
        },
      ]
    }
    return [
      {
        x: routePoint[endpoint].x,
        y: routePoint[endpoint].y,
        layers: [
          routePoint.route_type === "jumper"
            ? routePoint.layer
            : endpoint === "start"
              ? routePoint.from_layer
              : routePoint.to_layer,
        ],
      },
    ]
  })

const endpointIsInsideObstacle = (
  endpoint: { x: number; y: number; layers: string[] },
  obstacle: SimpleRouteJson["obstacles"][number],
): boolean => {
  if (!endpoint.layers.some((layer) => obstacle.layers.includes(layer))) {
    return false
  }

  const radians = -((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const deltaX = endpoint.x - obstacle.center.x
  const deltaY = endpoint.y - obstacle.center.y
  const localX = deltaX * Math.cos(radians) - deltaY * Math.sin(radians)
  const localY = deltaX * Math.sin(radians) + deltaY * Math.cos(radians)
  return (
    Math.abs(localX) <= obstacle.width / 2 + 1e-9 &&
    Math.abs(localY) <= obstacle.height / 2 + 1e-9
  )
}

const getDirectCanonicalNetEvidence = (
  srj: SimpleRouteJson,
  trace: SimplifiedPcbTrace,
  traceIndexByUniqueId: Map<string, number>,
): Set<string> => {
  const canonicalNetIds = new Set<string>()
  const directlyNamedConnection = srj.connections.find((connection) =>
    getConnectionIdentityIds(connection).has(trace.connection_name),
  )
  if (directlyNamedConnection) {
    canonicalNetIds.add(getCanonicalConnectionName(directlyNamedConnection))
  }

  const traceConnectedIds = new Set(trace.connectsTo ?? [])
  for (const connection of srj.connections) {
    if (
      [...getConnectionIdentityIds(connection)].some(
        (connectionId) =>
          !traceIndexByUniqueId.has(connectionId) &&
          traceConnectedIds.has(connectionId),
      )
    ) {
      canonicalNetIds.add(getCanonicalConnectionName(connection))
    }
  }

  const traceIdentityIds = new Set([
    trace.pcb_trace_id,
    trace.connection_name,
    ...traceConnectedIds,
  ])
  const endpoints = getSimplifiedTraceEndpoints(trace)
  for (const obstacle of srj.obstacles) {
    if (
      !obstacle.connectedTo.some((id) => traceIdentityIds.has(id)) ||
      !endpoints.some((endpoint) =>
        endpointIsInsideObstacle(endpoint, obstacle),
      )
    ) {
      continue
    }
    const obstacleConnectedIds = new Set(obstacle.connectedTo)
    for (const connection of srj.connections) {
      if (
        [...getConnectionIdentityIds(connection)].some((id) =>
          obstacleConnectedIds.has(id),
        )
      ) {
        canonicalNetIds.add(getCanonicalConnectionName(connection))
      }
    }
  }

  return canonicalNetIds
}

/**
 * Resolves fixed traces by explicit terminal/net evidence, then propagates a
 * unique canonical net through trace-id links. Ambiguous components retain
 * only per-trace unambiguous evidence and otherwise fall back to the raw name.
 */
export const resolvePreloadedTraceCanonicalNetIds = (
  srj: SimpleRouteJson,
): Map<string, string> => {
  const traces = srj.traces ?? []
  const traceIdCounts = new Map<string, number>()
  for (const trace of traces) {
    traceIdCounts.set(
      trace.pcb_trace_id,
      (traceIdCounts.get(trace.pcb_trace_id) ?? 0) + 1,
    )
  }
  const traceIndexByUniqueId = new Map<string, number>()
  for (const [traceIndex, trace] of traces.entries()) {
    if (traceIdCounts.get(trace.pcb_trace_id) === 1) {
      traceIndexByUniqueId.set(trace.pcb_trace_id, traceIndex)
    }
  }

  const parentByTraceIndex = traces.map((_, traceIndex) => traceIndex)
  const findRoot = (traceIndex: number): number => {
    const parent = parentByTraceIndex[traceIndex] ?? traceIndex
    if (parent === traceIndex) return traceIndex
    const root = findRoot(parent)
    parentByTraceIndex[traceIndex] = root
    return root
  }
  const union = (leftTraceIndex: number, rightTraceIndex: number) => {
    const leftRoot = findRoot(leftTraceIndex)
    const rightRoot = findRoot(rightTraceIndex)
    if (leftRoot !== rightRoot) parentByTraceIndex[rightRoot] = leftRoot
  }
  for (const [traceIndex, trace] of traces.entries()) {
    for (const connectedId of trace.connectsTo ?? []) {
      const connectedTraceIndex = traceIndexByUniqueId.get(connectedId)
      if (connectedTraceIndex !== undefined) {
        union(traceIndex, connectedTraceIndex)
      }
    }
  }

  const directEvidenceByTraceIndex = traces.map((trace) =>
    getDirectCanonicalNetEvidence(srj, trace, traceIndexByUniqueId),
  )
  const canonicalNetIdsByRoot = new Map<number, Set<string>>()
  for (const [
    traceIndex,
    canonicalNetIds,
  ] of directEvidenceByTraceIndex.entries()) {
    const root = findRoot(traceIndex)
    const componentNetIds = canonicalNetIdsByRoot.get(root) ?? new Set<string>()
    for (const canonicalNetId of canonicalNetIds) {
      componentNetIds.add(canonicalNetId)
    }
    canonicalNetIdsByRoot.set(root, componentNetIds)
  }

  const canonicalNetIdByTraceId = new Map<string, string>()
  for (const [traceIndex, trace] of traces.entries()) {
    if (traceIdCounts.get(trace.pcb_trace_id) !== 1) continue
    const componentNetIds =
      canonicalNetIdsByRoot.get(findRoot(traceIndex)) ?? new Set<string>()
    const directNetIds = directEvidenceByTraceIndex[traceIndex]!
    const canonicalNetId =
      componentNetIds.size === 1
        ? (componentNetIds.values().next().value ?? trace.connection_name)
        : directNetIds.size === 1
          ? (directNetIds.values().next().value ?? trace.connection_name)
          : trace.connection_name
    canonicalNetIdByTraceId.set(trace.pcb_trace_id, canonicalNetId)
  }
  return canonicalNetIdByTraceId
}
