import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import type { IndependentRouteSegment } from "./DuplicateCongestedPortSolverWithIndependentRoutes"

type RegionRouteSegment = {
  routeId: number
  netId: number
  lesserAngle: number
  greaterAngle: number
  layerMask: number
}

export type InitialRouteOrderingStats = {
  initialRouteOrderingRouteCount: number
  initialRouteOrderingChangedPositionCount: number
  initialRouteOrderingMaxConflictDegree: number
  initialRouteOrderingMaxPriority: number
}

/**
 * Schedule the most constrained nets first within the upstream cardinality
 * classes. Rank a net by its most constrained pending branch, retaining the
 * upstream net order when pressure is equal. Preserve each net's original
 * branch sequence because branches share copper and their order comes from
 * the connectivity plan.
 * Write each class back into its existing positions so committed branches do
 * not change a net's cardinality class or the upstream schedule. Reorder only
 * pending routes in the first pass; assignments, prices, and rerip stay intact.
 */
export const initializeTinyHypergraphRouteOrder = (
  solver: TinyHyperGraphSolver,
  independentRouteSegments: readonly IndependentRouteSegment[],
): InitialRouteOrderingStats => {
  if (
    solver.iterations !== 0 ||
    solver.state.ripCount !== 0 ||
    solver.state.currentRouteId !== undefined
  ) {
    throw new Error("Initial route ordering requires an unstarted first-pass solver")
  }
  const { topology, problem, state } = solver
  const routeIdByConnectionId = new Map<string, number>()
  const regionIdBySerializedId = new Map<string, number>()
  const portIdBySerializedId = new Map<string, number>()
  const netCardinality = new Map<number, number>()
  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    const connectionId = problem.routeMetadata?.[routeId]?.connectionId
    if (typeof connectionId !== "string") {
      throw new Error(`Initial route ordering requires an identifier for route ${routeId}`)
    }
    routeIdByConnectionId.set(connectionId, routeId)
    const netId = problem.routeNet[routeId]!
    netCardinality.set(netId, (netCardinality.get(netId) ?? 0) + 1)
  }
  for (let regionId = 0; regionId < topology.regionCount; regionId++) {
    const serializedRegionId = topology.regionMetadata?.[regionId]?.serializedRegionId
    if (typeof serializedRegionId !== "string") {
      throw new Error(`Initial route ordering requires an identifier for region ${regionId}`)
    }
    regionIdBySerializedId.set(serializedRegionId, regionId)
  }

  const physicalSlotCountByBoundary = new Map<string, number>()
  const boundaryKeyByPort = new Array<string | undefined>(topology.portCount)
  for (let portId = 0; portId < topology.portCount; portId++) {
    const serializedPortId = topology.portMetadata?.[portId]?.serializedPortId
    if (typeof serializedPortId !== "string") {
      throw new Error(`Initial route ordering requires an identifier for port ${portId}`)
    }
    portIdBySerializedId.set(serializedPortId, portId)
    if (topology.portMetadata?.[portId]?.duplicatedFromPortId !== undefined) continue
    const incident = topology.incidentPortRegion[portId]!
    if (incident.length !== 2) continue
    const key = `${Math.min(incident[0]!, incident[1]!)}:${Math.max(incident[0]!, incident[1]!)}:${topology.portZ[portId]!}`
    boundaryKeyByPort[portId] = key
    physicalSlotCountByBoundary.set(key, (physicalSlotCountByBoundary.get(key) ?? 0) + 1)
  }

  const segmentsByRegion: RegionRouteSegment[][] = Array.from(
    { length: topology.regionCount },
    () => [],
  )
  const minimumSlotCountByRoute = new Float64Array(problem.routeCount).fill(Number.POSITIVE_INFINITY)
  for (const segment of independentRouteSegments) {
    const routeId = routeIdByConnectionId.get(segment.connectionId)
    const regionId = regionIdBySerializedId.get(segment.regionId)
    if (routeId === undefined || regionId === undefined) {
      throw new Error(`Independent route "${segment.connectionId}" references a missing route or region "${segment.regionId}"`)
    }
    const fromPortId = portIdBySerializedId.get(segment.fromPortId)
    const toPortId = portIdBySerializedId.get(segment.toPortId)
    if (fromPortId === undefined || toPortId === undefined) {
      throw new Error(`Independent route "${segment.connectionId}" references missing ports`)
    }
    for (const portId of [fromPortId, toPortId]) {
      const incident = topology.incidentPortRegion[portId]!
      if (!incident.includes(regionId) || boundaryKeyByPort[portId] === undefined) {
        throw new Error(`Independent route "${segment.connectionId}" has an invalid physical boundary port "${topology.portMetadata?.[portId]?.serializedPortId}"`)
      }
      // A terminal's one forced port cannot distinguish route flexibility.
      // Measure physical alternatives only on interior transit boundaries.
      if (incident.every((incidentRegionId) =>
        problem.regionNetId[incidentRegionId] === -1 &&
        topology.regionMetadata?.[incidentRegionId]?._tinyTerminalNetId === undefined,
      )) {
        const slotCount = physicalSlotCountByBoundary.get(boundaryKeyByPort[portId]!)!
        minimumSlotCountByRoute[routeId] = Math.min(minimumSlotCountByRoute[routeId]!, slotCount)
      }
    }
    if (problem.regionNetId[regionId] !== -1) continue
    const fromAngle = topology.incidentPortRegion[fromPortId]![0] === regionId
      ? topology.portAngleForRegion1[fromPortId]!
      : topology.portAngleForRegion2![fromPortId]!
    const toAngle = topology.incidentPortRegion[toPortId]![0] === regionId
      ? topology.portAngleForRegion1[toPortId]!
      : topology.portAngleForRegion2![toPortId]!
    segmentsByRegion[regionId]!.push({
      routeId,
      netId: problem.routeNet[routeId]!,
      lesserAngle: Math.min(fromAngle, toAngle),
      greaterAngle: Math.max(fromAngle, toAngle),
      layerMask: (1 << topology.portZ[fromPortId]!) | (1 << topology.portZ[toPortId]!),
    })
  }

  const conflictingRoutes: Map<number, number>[] = Array.from(
    { length: problem.routeCount },
    () => new Map<number, number>(),
  )
  for (const segments of segmentsByRegion) {
    for (let i = 0; i < segments.length; i++) {
      const left = segments[i]!
      for (let j = i + 1; j < segments.length; j++) {
        const right = segments[j]!
        if (left.netId === right.netId) continue
        const lesserInside = left.lesserAngle < right.lesserAngle && right.lesserAngle < left.greaterAngle
        const greaterInside = left.lesserAngle < right.greaterAngle && right.greaterAngle < left.greaterAngle
        if (lesserInside === greaterInside) continue
        // Tiny's region cost estimates two vias for an overlapping-layer
        // crossing and one for disjoint layers. Keep one weighted conflict
        // per foreign route, using its strongest crossing across regions.
        const weight = (left.layerMask & right.layerMask) !== 0 ? 1 : 0.5
        const leftConflicts = conflictingRoutes[left.routeId]!
        const rightConflicts = conflictingRoutes[right.routeId]!
        leftConflicts.set(right.routeId, Math.max(leftConflicts.get(right.routeId) ?? 0, weight))
        rightConflicts.set(left.routeId, Math.max(rightConflicts.get(left.routeId) ?? 0, weight))
      }
    }
  }
  const priorityByRoute = new Float64Array(problem.routeCount)
  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    // A direct route with no interior boundary has one physical path between
    // its terminals. It has no transit-slot multiplicity to measure.
    const slotCount = minimumSlotCountByRoute[routeId] === Number.POSITIVE_INFINITY
      ? 1
      : minimumSlotCountByRoute[routeId]!
    let conflictPressure = 0
    for (const weight of conflictingRoutes[routeId]!.values()) conflictPressure += weight
    priorityByRoute[routeId] = conflictPressure / slotCount
  }
  const originalOrder = [...state.unroutedRoutes]
  const maxPriorityByNet = new Map<number, number>()
  const routesByCardinality = new Map<number, number[]>()
  for (const routeId of originalOrder) {
    const netId = problem.routeNet[routeId]!
    maxPriorityByNet.set(netId, Math.max(maxPriorityByNet.get(netId) ?? 0, priorityByRoute[routeId]!))
    const cardinality = netCardinality.get(netId)!
    const existingRoutes = routesByCardinality.get(cardinality)
    if (existingRoutes === undefined) {
      routesByCardinality.set(cardinality, [routeId])
    } else {
      existingRoutes.push(routeId)
    }
  }
  const nextRouteIndexByCardinality = new Map<number, number>()
  for (const [cardinality, routes] of routesByCardinality) {
    // All branches of a net have the same key. Stable sorting preserves each
    // branch sequence and the exact upstream interleaving of tied nets.
    routes.sort((left, right): number =>
      maxPriorityByNet.get(problem.routeNet[right]!)! -
      maxPriorityByNet.get(problem.routeNet[left]!)!,
    )
    nextRouteIndexByCardinality.set(cardinality, 0)
  }
  state.unroutedRoutes = originalOrder.map((routeId): number => {
    const cardinality = netCardinality.get(problem.routeNet[routeId]!)!
    const nextIndex = nextRouteIndexByCardinality.get(cardinality)!
    nextRouteIndexByCardinality.set(cardinality, nextIndex + 1)
    return routesByCardinality.get(cardinality)![nextIndex]!
  })
  const stats: InitialRouteOrderingStats = {
    initialRouteOrderingRouteCount: state.unroutedRoutes.length,
    initialRouteOrderingChangedPositionCount: state.unroutedRoutes.reduce(
      (count, routeId, index) => count + Number(originalOrder[index] !== routeId),
      0,
    ),
    initialRouteOrderingMaxConflictDegree: Math.max(0, ...conflictingRoutes.map((routes) => routes.size)),
    initialRouteOrderingMaxPriority: Math.max(0, ...priorityByRoute),
  }
  solver.stats = { ...solver.stats, ...stats }
  return stats
}
