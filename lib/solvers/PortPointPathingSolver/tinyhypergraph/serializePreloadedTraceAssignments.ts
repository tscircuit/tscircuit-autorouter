import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { PreloadedTracePortAssignment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { TraceId } from "lib/types"

type SerializedRegionId = SerializedHyperGraph["regions"][number]["regionId"]

type SerializedPort = SerializedHyperGraph["ports"][number]
type SerializedRegion = SerializedHyperGraph["regions"][number]
type SerializedConnection = NonNullable<
  SerializedHyperGraph["connections"]
>[number]
type SerializedSolvedRoute = NonNullable<
  SerializedHyperGraph["solvedRoutes"]
>[number]

export type PreloadedTraceConnectionId = string & {
  readonly __brand: "PreloadedTraceConnectionId"
}

export type PreloadedTraceSectionMetadata = {
  traceId: string
  startRoutePosition: number
  endRoutePosition: number
  startPoint: { x: number; y: number; z: number }
  endPoint: { x: number; y: number; z: number }
}

export type PreloadedTraceConnectionMetadata = {
  connectionId: PreloadedTraceConnectionId
  isFixed?: boolean
  preloadedTraceSection: PreloadedTraceSectionMetadata
}

type PortMetadataWithPreloadedAssignments = {
  _preloadedTracePortAssignments?: PreloadedTracePortAssignment[]
}

type OrderedTracePort = {
  port: SerializedPort
  assignment: PreloadedTracePortAssignment
}

type PreloadedAssignmentSegment = {
  isFixed: boolean
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
const TRACE_POINT_TOLERANCE_MM = 1e-6

export const hasPreloadedTraceSectionMetadata = (
  metadata: unknown,
): metadata is PreloadedTraceConnectionMetadata => {
  if (typeof metadata !== "object" || metadata === null) return false
  const candidate = metadata as {
    connectionId?: unknown
    preloadedTraceSection?: {
      traceId?: unknown
      startRoutePosition?: unknown
      endRoutePosition?: unknown
      startPoint?: { x?: unknown; y?: unknown; z?: unknown }
      endPoint?: { x?: unknown; y?: unknown; z?: unknown }
    }
  }
  const section = candidate.preloadedTraceSection
  return (
    typeof candidate.connectionId === "string" &&
    typeof section?.traceId === "string" &&
    typeof section.startRoutePosition === "number" &&
    typeof section.endRoutePosition === "number" &&
    typeof section.startPoint?.x === "number" &&
    typeof section.startPoint.y === "number" &&
    typeof section.startPoint.z === "number" &&
    typeof section.endPoint?.x === "number" &&
    typeof section.endPoint.y === "number" &&
    typeof section.endPoint.z === "number"
  )
}

const getPreloadedTraceConnectionId = (
  traceId: string,
  contiguousRunIndex: number,
) =>
  `${PRELOADED_TRACE_CONNECTION_PREFIX}${JSON.stringify([
    traceId,
    contiguousRunIndex,
  ])}` as PreloadedTraceConnectionId

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

const chooseAssignmentRegionId = ({
  orderedPorts,
  pairIndex,
  previousRegionId,
}: {
  orderedPorts: OrderedTracePort[]
  pairIndex: number
  previousRegionId?: string
}): string | undefined => {
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
 * A mesh corner can contain several edge ports at one saved-path crossing.
 * Unconnected obstacle regions hold the pads the copper lands on; they bound
 * a run of segments instead of carrying one.
 */
const getFixedTraceSegments = (
  orderedPorts: OrderedTracePort[],
  unconnectedObstacleRegionIds: ReadonlySet<SerializedRegionId>,
): PreloadedAssignmentSegment[] => {
  const segments: PreloadedAssignmentSegment[] = []
  const crossingGroups: OrderedTracePort[][] = []
  for (const crossing of orderedPorts) {
    const group = crossingGroups.at(-1)
    const previous = group?.[0]
    if (
      group &&
      previous &&
      previous.assignment.z === crossing.assignment.z &&
      Math.abs(
        previous.assignment.routePosition - crossing.assignment.routePosition,
      ) <= ROUTE_POSITION_TOLERANCE
    ) {
      group.push(crossing)
    } else {
      crossingGroups.push([crossing])
    }
  }
  for (let index = 1; index < crossingGroups.length; index++) {
    const fromByRegion = new Map<SerializedRegionId, OrderedTracePort>()
    for (const from of crossingGroups[index - 1]!) {
      for (const regionId of getIncidentRegionIds(from.port)) {
        fromByRegion.set(regionId, from)
      }
    }
    const emittedRegionIds = new Set<SerializedRegionId>()
    for (const to of crossingGroups[index]!) {
      for (const regionId of getIncidentRegionIds(to.port)) {
        const from = fromByRegion.get(regionId)
        if (
          !from ||
          emittedRegionIds.has(regionId) ||
          unconnectedObstacleRegionIds.has(regionId) ||
          from.port.portId === to.port.portId
        ) {
          continue
        }
        segments.push({ regionId, from, to, isFixed: true })
        emittedRegionIds.add(regionId)
      }
    }
  }
  return segments
}

/**
 * Converts ordered existing-trace boundary crossings into ordinary serialized
 * hypergraph assignments. No graph regions or ports are added.
 */
export const serializePreloadedTraceAssignments = (
  serializedHyperGraph: SerializedHyperGraph,
): SerializedPreloadedTraceStats => {
  const orderedPortsByTraceId = new Map<string, OrderedTracePort[]>()
  const fixedPadCrossingsByTraceId = new Map<TraceId, OrderedTracePort[]>()
  const fixedNetIdByTraceId = new Map<string, string>()
  const fixedTraceIds = new Set<TraceId>()
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
    const removedRegionCount = getIncidentRegionIds(port).filter((regionId) =>
      removedObstacleRegionIds.has(regionId),
    ).length

    for (const assignment of assignments) {
      if (removedRegionCount > 0) {
        if (assignment.isFixed && removedRegionCount === 1) {
          const padCrossings =
            fixedPadCrossingsByTraceId.get(assignment.traceId) ?? []
          padCrossings.push({ port, assignment })
          fixedPadCrossingsByTraceId.set(assignment.traceId, padCrossings)
        }
        continue
      }
      if (assignment.isFixed) fixedTraceIds.add(assignment.traceId)
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

  // Fixed copper that crosses fewer than two connected boundaries would leave
  // nothing in the graph. It keeps the crossings into the pads it lands on;
  // those pad regions become endpoints of its saved route and stay in the graph.
  for (const [traceId, padCrossings] of fixedPadCrossingsByTraceId) {
    const connectedCrossings = orderedPortsByTraceId.get(traceId) ?? []
    const connectedPortIds = new Set(
      connectedCrossings.map(({ port }) => port.portId),
    )
    if (connectedPortIds.size >= 2) continue
    fixedTraceIds.add(traceId)
    fixedNetIdByTraceId.set(traceId, padCrossings[0]!.assignment.fixedNetId)
    orderedPortsByTraceId.set(traceId, [...connectedCrossings, ...padCrossings])
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
    if (fixedTraceIds.has(traceId)) {
      segments.push(
        ...getFixedTraceSegments(orderedPorts, removedObstacleRegionIds),
      )
    }
    for (
      let pairIndex = 0;
      !fixedTraceIds.has(traceId) && pairIndex < orderedPorts.length - 1;
      pairIndex++
    ) {
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
      const regionId = chooseAssignmentRegionId({
        orderedPorts,
        pairIndex,
        previousRegionId,
      })
      if (!regionId) {
        previousRegionId = undefined
        continue
      }
      const geometry = regionById.get(regionId)?.d
      const isCollapsedLayerTransition =
        from.assignment.z !== to.assignment.z &&
        typeof from.port.d?.x === "number" &&
        typeof from.port.d?.y === "number" &&
        from.port.d.x === to.port.d?.x &&
        from.port.d.y === to.port.d?.y
      // Keep the graph's original connectivity without asking high-density
      // routing to reconstruct this via inside the neighboring cell.
      const isFixed =
        fixedTraceIds.has(traceId) ||
        Boolean(
          isCollapsedLayerTransition &&
            geometry?.center &&
            [from.assignment.tracePoint, to.assignment.tracePoint].some(
              (point) =>
                Math.abs(point.x - geometry.center.x) >
                  geometry.width / 2 + TRACE_POINT_TOLERANCE_MM ||
                Math.abs(point.y - geometry.center.y) >
                  geometry.height / 2 + TRACE_POINT_TOLERANCE_MM,
            ),
        )
      segments.push({ regionId, from, to, isFixed })
      previousRegionId = regionId
    }

    const contiguousRuns: PreloadedAssignmentSegment[][] = []
    for (const segment of segments) {
      const currentRun = contiguousRuns.at(-1)
      if (
        !currentRun ||
        currentRun.at(-1)!.to.port.portId !== segment.from.port.portId ||
        currentRun[0]!.isFixed !== segment.isFixed
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
      const connection: SerializedConnection &
        PreloadedTraceConnectionMetadata = {
        connectionId,
        ...(firstSegment.isFixed && { isFixed: true }),
        mutuallyConnectedNetworkId: fixedNetIdByTraceId.get(traceId) ?? traceId,
        startRegionId: getEndpointRegionId(firstPort, firstSegment.regionId),
        endRegionId: getEndpointRegionId(lastPort, lastSegment.regionId),
        preloadedTraceSection: {
          traceId,
          startRoutePosition: firstSegment.from.assignment.routePosition,
          endRoutePosition: lastSegment.to.assignment.routePosition,
          startPoint: {
            x: firstSegment.from.assignment.tracePoint.x,
            y: firstSegment.from.assignment.tracePoint.y,
            z: firstSegment.from.assignment.z,
          },
          endPoint: {
            x: lastSegment.to.assignment.tracePoint.x,
            y: lastSegment.to.assignment.tracePoint.y,
            z: lastSegment.to.assignment.z,
          },
        } satisfies PreloadedTraceSectionMetadata,
      }
      connections.push(connection)
      solvedRoutes.push({
        requiredRip: false,
        connection,
        path: [firstPort, lastPort].map((port) => ({
          portId: port.portId,
          g: 0,
          h: 0,
          f: 0,
          hops: 0,
          ripRequired: false,
        })),
      })
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
  const preloadedConnectionIds = new Set<string>(
    (serializedHyperGraph.connections ?? [])
      .filter(hasPreloadedTraceSectionMetadata)
      .map((connection) => connection.connectionId),
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
