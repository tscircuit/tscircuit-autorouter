import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { getFixedRouteBlockedIntervals } from "lib/solvers/UniformPortDistributionSolver/getFixedRouteBlockedIntervals"
import type { SharedEdge } from "lib/solvers/UniformPortDistributionSolver/types"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { convertPreloadedTraceToHdRoutes } from "./convertPreloadedTraceToHdRoutes"
import { removeChangedSectionsFromFixedHdRoutes } from "./materializeHypergraphPreloadedTraceSections"
import { getBoundaryPlacementWitnesses } from "./getBoundaryPlacementWitnesses"
import { getPipeline9PhysicalOwnership, getPipeline9PhysicalRouteOwner } from "./getPipeline9PhysicalOwnership"

type Interval = { start: number; end: number }

const getFreeIntervals = (length: number, intervals: Interval[]): Interval[] => {
  let start = 0
  const free: Interval[] = []
  for (const interval of intervals) {
    if (interval.end <= start) continue
    if (interval.start >= start && start <= length) free.push({ start, end: Math.min(interval.start, length) })
    start = Math.max(start, interval.end)
    if (start > length) break
  }
  if (start <= length) free.push({ start, end: length })
  return free
}

/** Only copper outside every reroutable section supplies an immutable boundary constraint. */
export const annotateFixedCopperBoundarySupply = (
  sharedEdgeSegments: SharedEdgeSegment[],
  srj: SimpleRouteJson,
  reroutableSections: Array<{ traceId: string; startRoutePosition: number; endRoutePosition: number }> = [],
  originalSrj: SimpleRouteJson = srj,
): { constrainedBoundaryLayers: number; constrainedPorts: number } => {
  for (const segment of sharedEdgeSegments) {
    for (const point of segment.portPoints) {
      delete point.allowedNetIdByZ
      delete point.positionByZ
    }
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const viaDiameter = getViaDimensions(srj).padDiameter
  const originalRoutes = (srj.traces ?? []).flatMap((trace, index) =>
    convertPreloadedTraceToHdRoutes(trace, index, srj.layerCount, viaDiameter, connMap),
  ).map((route) => !srj.allowBlindAndBuriedVias && route.route[0]!.z !== route.route.at(-1)!.z ? {
    ...route, route: [{ ...route.route[0]!, z: 0 }, { ...route.route.at(-1)!, z: srj.layerCount - 1 }],
  } : route)
  const routes = removeChangedSectionsFromFixedHdRoutes({
    traces: srj.traces ?? [], fixedHdRoutes: originalRoutes, sections: reroutableSections,
  })
  if (routes.length === 0) return { constrainedBoundaryLayers: 0, constrainedPorts: 0 }
  const ownership = getPipeline9PhysicalOwnership({
    originalSrj, derivedConnections: srj.connections, derivedTraces: srj.traces ?? [], routingConnMap: connMap,
    derivedRouteAliases: routes.map((route) => ({ connectionName: route.connectionName,
      parentTraceId: srj.traces![route.preloadedTraceIndex]!.pcb_trace_id })),
  })
  const netByConnectionName = new Map(routes.map((route) => [route.connectionName,
    getPipeline9PhysicalRouteOwner(ownership, route) ?? `unproven_physical_route:${route.connectionName}`,
  ]))
  const liveRoutingNetIds = new Set(Object.values(connMap.idToNetMap))
  const routingNetIdsByPhysicalOwner = new Map<string, string[]>()
  for (const [netId, owner] of Object.entries(ownership.routingNetOwners)) {
    if (owner === null || !liveRoutingNetIds.has(netId)) continue
    const ids = routingNetIdsByPhysicalOwner.get(owner) ?? []
    ids.push(netId)
    routingNetIdsByPhysicalOwner.set(owner, ids)
  }
  const clearance = srj.defaultObstacleMargin ?? 0.15
  const boundedRoutes = routes.map((route) => ({
    route,
    minX: Math.min(...route.route.map((point) => point.x)),
    maxX: Math.max(...route.route.map((point) => point.x)),
    minY: Math.min(...route.route.map((point) => point.y)),
    maxY: Math.max(...route.route.map((point) => point.y)),
    radius: (Math.max(route.traceThickness, route.viaDiameter) + srj.minTraceWidth) / 2 + clearance,
  }))
  let constrainedBoundaryLayers = 0
  let constrainedPorts = 0
  for (const segment of sharedEdgeSegments) {
    const horizontal = segment.start.y === segment.end.y
    if (!horizontal && segment.start.x !== segment.end.x) {
      throw new Error(`Physical boundary "${segment.edgeId}" is not axis aligned`)
    }
    const x1 = Math.min(segment.start.x, segment.end.x)
    const x2 = Math.max(segment.start.x, segment.end.x)
    const y1 = Math.min(segment.start.y, segment.end.y)
    const y2 = Math.max(segment.start.y, segment.end.y)
    const length = horizontal ? x2 - x1 : y2 - y1
    const nearby = boundedRoutes.filter((entry) =>
      entry.maxX + entry.radius >= Math.min(segment.start.x, segment.end.x) &&
      entry.minX - entry.radius <= Math.max(segment.start.x, segment.end.x) &&
      entry.maxY + entry.radius >= Math.min(segment.start.y, segment.end.y) &&
      entry.minY - entry.radius <= Math.max(segment.start.y, segment.end.y),
    ).map((entry) => entry.route)
    if (nearby.length === 0) continue
    const edge: SharedEdge = {
      ownerNodeIds: segment.nodeIds, ownerPairKey: segment.nodeIds.join("|"),
      orientation: horizontal ? "horizontal" : "vertical",
      x1, y1, x2, y2,
      length, center: { x: (segment.start.x + segment.end.x) / 2, y: (segment.start.y + segment.end.y) / 2 },
      nodeSideByOwnerId: {},
    }
    const ownerNetIds = [...new Set(nearby.map((route) => netByConnectionName.get(route.connectionName)!))]
    let foreignNetId = "__physical_boundary_foreign_net__"
    while (ownerNetIds.includes(foreignNetId)) foreignNetId += ":"
    for (const z of segment.availableZ) {
      const blocked = getFixedRouteBlockedIntervals({
        sharedEdge: edge, fixedRoutes: nearby, z, netId: foreignNetId,
        traceWidth: srj.minTraceWidth, clearance, netByConnectionName,
      })
      if (blocked.length === 0) continue
      const layerPoints = segment.portPoints.filter((point) => point.availableZ.includes(z))
      const freeIntervals = getFreeIntervals(length, blocked)
      const spacing = srj.minTraceWidth + clearance
      const candidates = layerPoints.map((point) => ({ id: point.segmentPortPointId,
        position: horizontal ? point.x - x1 : point.y - y1,
        fixed: (point._preloadedTracePortAssignments ?? []).some((assignment) => assignment.z === z),
      }))
      const alreadyClear = candidates.every((candidate) => freeIntervals.some((interval) => candidate.position >= interval.start && candidate.position <= interval.end))
      const ordered = [...candidates].sort((a, b) => a.position - b.position)
      if (alreadyClear && ordered.every((candidate, index) => index === 0 || candidate.position - ordered[index - 1]!.position >= spacing)) continue
      const witnesses = getBoundaryPlacementWitnesses(candidates, freeIntervals, spacing)
      const movable = candidates.filter((candidate) => !candidate.fixed).sort((a, b) => a.position - b.position)
      const positionById = new Map(witnesses.movablePositions.map((position, index) => [movable[index]!.id, position]))
      for (const point of layerPoints) {
        const position = positionById.get(point.segmentPortPointId)
        if (position !== undefined) {
          point.positionByZ = { ...point.positionByZ, [z]: {
            x: horizontal ? x1 + position : x1, y: horizontal ? y1 : y1 + position,
          } }
          continue
        }
        if (witnesses.fixedIds.has(point.segmentPortPointId)) continue
        const pointEdge: SharedEdge = { ...edge, x1: point.x, x2: point.x, y1: point.y, y2: point.y, length: 0 }
        const blockingOwners = ownerNetIds.filter((owner) => getFixedRouteBlockedIntervals({
          sharedEdge: pointEdge, fixedRoutes: nearby.filter((route) => netByConnectionName.get(route.connectionName) === owner), z,
          netId: foreignNetId, traceWidth: srj.minTraceWidth, clearance, netByConnectionName,
        }).length > 0)
        const assignedOwners = [...new Set((point._preloadedTracePortAssignments ?? []).filter((assignment) =>
          assignment.z === z && ownership.routingNetOwners[assignment.fixedNetId] !== null && ownership.routingNetOwners[assignment.fixedNetId] !== undefined,
        ).map((assignment) => assignment.fixedNetId))]
        const provenIds = blockingOwners.length === 1 ? routingNetIdsByPhysicalOwner.get(blockingOwners[0]!) : undefined
        const allowedNetId = blockingOwners.length === 1 ? provenIds?.length === 1 ? provenIds[0]! : null
          : blockingOwners.length === 0 && assignedOwners.length === 1 ? assignedOwners[0]! : null
        point.allowedNetIdByZ = { ...point.allowedNetIdByZ, [z]: allowedNetId }
        constrainedPorts++
      }
      constrainedBoundaryLayers++
    }
  }
  return { constrainedBoundaryLayers, constrainedPorts }
}
