import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { PreloadedTracePortAssignment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"

type SerializedPort = SerializedHyperGraph["ports"][number]
type SerializedRegion = SerializedHyperGraph["regions"][number]
type SerializedConnection = NonNullable<
  SerializedHyperGraph["connections"]
>[number]
type SerializedSolvedRoute = NonNullable<
  SerializedHyperGraph["solvedRoutes"]
>[number]

type PortMetadataWithPreloadedAssignments = {
  _preloadedTracePortAssignments?: PreloadedTracePortAssignment[]
}

type OrderedTracePort = {
  port: SerializedPort
  assignment: PreloadedTracePortAssignment
}

type PreloadedAssignmentSegment = {
  regionId: string
  from: OrderedTracePort
  to: OrderedTracePort
}

export type SerializedPreloadedTraceStats = {
  preloadedTraceCount: number
  preloadedPortCount: number
  preloadedAssignmentCount: number
}

const PRELOADED_TRACE_CONNECTION_PREFIX = "__tscircuit_preloaded_trace__:"
const ROUTE_POSITION_TOLERANCE = 1e-6

export const isPreloadedTraceConnectionId = (connectionId: string) =>
  connectionId.startsWith(PRELOADED_TRACE_CONNECTION_PREFIX)

const getPreloadedTraceConnectionId = (
  traceId: string,
  contiguousRunIndex: number,
) =>
  `${PRELOADED_TRACE_CONNECTION_PREFIX}${JSON.stringify([
    traceId,
    contiguousRunIndex,
  ])}`

const getIncidentRegionIds = (port: SerializedPort) => [
  port.region1Id,
  port.region2Id,
]

const getSharedRegionIds = (
  firstPort: SerializedPort,
  secondPort: SerializedPort,
) => {
  const secondRegionIds = new Set(getIncidentRegionIds(secondPort))
  return getIncidentRegionIds(firstPort).filter((regionId) =>
    secondRegionIds.has(regionId),
  )
}

const chooseAssignmentRegionId = (
  orderedPorts: OrderedTracePort[],
  pairIndex: number,
  previousRegionId?: string,
) => {
  const from = orderedPorts[pairIndex]!
  const to = orderedPorts[pairIndex + 1]!
  const sharedRegionIds = getSharedRegionIds(from.port, to.port)
  if (sharedRegionIds.length === 0) return undefined
  if (sharedRegionIds.length === 1) return sharedRegionIds[0]

  const next = orderedPorts[pairIndex + 2]
  if (next) {
    const nextSharedRegionIds = new Set(getSharedRegionIds(to.port, next.port))
    const continuingRegionId = sharedRegionIds.find((regionId) =>
      nextSharedRegionIds.has(regionId),
    )
    if (continuingRegionId) return continuingRegionId
  }

  if (previousRegionId && sharedRegionIds.includes(previousRegionId)) {
    return previousRegionId
  }

  return [...sharedRegionIds].sort()[0]
}

const getEndpointRegionId = (
  endpointPort: SerializedPort,
  adjacentAssignmentRegionId: string,
) =>
  getIncidentRegionIds(endpointPort).find(
    (regionId) => regionId !== adjacentAssignmentRegionId,
  ) ?? adjacentAssignmentRegionId

/**
 * Converts Pipeline9's ordered boundary crossings into ordinary serialized
 * hypergraph assignments. The preloaded connections only provide route
 * ownership for those assignments; no regions or ports are added.
 */
export const serializePreloadedTraceAssignments = (
  serializedHyperGraph: SerializedHyperGraph,
): SerializedPreloadedTraceStats => {
  const orderedPortsByTraceId = new Map<string, OrderedTracePort[]>()
  const fixedNetIdByTraceId = new Map<string, string>()
  const connectedRegionIds = new Set(
    (serializedHyperGraph.connections ?? []).flatMap((connection) => [
      connection.startRegionId,
      connection.endRegionId,
    ]),
  )
  const removedObstacleRegionIds = new Set(
    serializedHyperGraph.regions
      .filter((region) => {
        const netId =
          typeof region.d?.netId === "number"
            ? region.d.netId
            : typeof region.d?.NetId === "number"
              ? region.d.NetId
              : undefined
        return (
          region.d?._containsObstacle === true &&
          (netId === undefined || netId === -1) &&
          !connectedRegionIds.has(region.regionId)
        )
      })
      .map((region) => region.regionId),
  )
  let preloadedPortCount = 0

  for (const port of serializedHyperGraph.ports) {
    const metadata = port.d as PortMetadataWithPreloadedAssignments | undefined
    const assignments = metadata?._preloadedTracePortAssignments ?? []
    if (assignments.length > 0) preloadedPortCount++
    if (
      removedObstacleRegionIds.has(port.region1Id) ||
      removedObstacleRegionIds.has(port.region2Id)
    ) {
      continue
    }

    for (const assignment of assignments) {
      const existingFixedNetId = fixedNetIdByTraceId.get(assignment.traceId)
      if (
        existingFixedNetId !== undefined &&
        existingFixedNetId !== assignment.fixedNetId
      ) {
        throw new Error(
          `Preloaded trace "${assignment.traceId}" maps to multiple canonical nets`,
        )
      }
      fixedNetIdByTraceId.set(assignment.traceId, assignment.fixedNetId)
      const orderedPorts = orderedPortsByTraceId.get(assignment.traceId) ?? []
      orderedPorts.push({ port, assignment })
      orderedPortsByTraceId.set(assignment.traceId, orderedPorts)
    }
  }

  const regionById = new Map(
    serializedHyperGraph.regions.map((region) => [region.regionId, region]),
  )
  const connections = (serializedHyperGraph.connections ??= [])
  const solvedRoutes = (serializedHyperGraph.solvedRoutes ??= [])
  let preloadedTraceCount = 0
  let preloadedAssignmentCount = 0

  for (const [traceId, tracePorts] of orderedPortsByTraceId) {
    tracePorts.sort(
      (left, right) =>
        left.assignment.routePosition - right.assignment.routePosition ||
        left.assignment.z - right.assignment.z ||
        left.port.portId.localeCompare(right.port.portId),
    )
    const orderedPorts = tracePorts.filter(
      ({ port }, index) =>
        index === 0 || port.portId !== tracePorts[index - 1]!.port.portId,
    )
    if (orderedPorts.length < 2) continue

    const segments: PreloadedAssignmentSegment[] = []
    let previousRegionId: string | undefined
    for (let pairIndex = 0; pairIndex < orderedPorts.length - 1; pairIndex++) {
      const from = orderedPorts[pairIndex]!
      const to = orderedPorts[pairIndex + 1]!
      if (
        from.assignment.z === to.assignment.z &&
        Math.abs(from.assignment.routePosition - to.assignment.routePosition) <=
          ROUTE_POSITION_TOLERANCE
      ) {
        previousRegionId = undefined
        continue
      }
      const regionId = chooseAssignmentRegionId(
        orderedPorts,
        pairIndex,
        previousRegionId,
      )
      if (!regionId) {
        previousRegionId = undefined
        continue
      }
      segments.push({ regionId, from, to })
      previousRegionId = regionId
    }

    const contiguousRuns: PreloadedAssignmentSegment[][] = []
    for (const segment of segments) {
      const currentRun = contiguousRuns.at(-1)
      if (
        !currentRun ||
        currentRun.at(-1)!.to.port.portId !== segment.from.port.portId
      ) {
        contiguousRuns.push([segment])
      } else {
        currentRun.push(segment)
      }
    }

    for (const [runIndex, run] of contiguousRuns.entries()) {
      const connectionId = getPreloadedTraceConnectionId(traceId, runIndex)
      for (const segment of run) {
        const region = regionById.get(segment.regionId)
        if (!region) {
          throw new Error(
            `Preloaded trace "${traceId}" references missing region "${segment.regionId}"`,
          )
        }
        region.assignments = [
          ...(region.assignments ?? []),
          {
            regionPort1Id: segment.from.port.portId,
            regionPort2Id: segment.to.port.portId,
            connectionId,
          },
        ]
        preloadedAssignmentCount++
      }

      const firstSegment = run[0]!
      const lastSegment = run.at(-1)!
      const firstPort = firstSegment.from.port
      const lastPort = lastSegment.to.port
      const connection: SerializedConnection = {
        connectionId,
        mutuallyConnectedNetworkId: fixedNetIdByTraceId.get(traceId) ?? traceId,
        startRegionId: getEndpointRegionId(firstPort, firstSegment.regionId),
        endRegionId: getEndpointRegionId(lastPort, lastSegment.regionId),
      }
      connections.push(connection)
      solvedRoutes.push({
        connection: { connectionId },
        path: [{ portId: firstPort.portId }, { portId: lastPort.portId }],
      } as SerializedSolvedRoute)
    }
    if (contiguousRuns.length > 0) {
      preloadedTraceCount++
    }
  }

  return {
    preloadedTraceCount,
    preloadedPortCount,
    preloadedAssignmentCount,
  }
}

export const getSerializedPreloadedTraceStats = (
  serializedHyperGraph: SerializedHyperGraph,
): SerializedPreloadedTraceStats => {
  const preloadedConnectionIds = new Set(
    (serializedHyperGraph.connections ?? [])
      .map((connection) => connection.connectionId)
      .filter(isPreloadedTraceConnectionId),
  )
  const preloadedPortCount = serializedHyperGraph.ports.filter(
    (port) =>
      ((port.d as PortMetadataWithPreloadedAssignments | undefined)
        ?._preloadedTracePortAssignments?.length ?? 0) > 0,
  ).length
  const preloadedAssignmentCount = serializedHyperGraph.regions.reduce(
    (count, region: SerializedRegion) =>
      count +
      (region.assignments ?? []).filter((assignment) =>
        preloadedConnectionIds.has(assignment.connectionId),
      ).length,
    0,
  )

  return {
    preloadedTraceCount: preloadedConnectionIds.size,
    preloadedPortCount,
    preloadedAssignmentCount,
  }
}
