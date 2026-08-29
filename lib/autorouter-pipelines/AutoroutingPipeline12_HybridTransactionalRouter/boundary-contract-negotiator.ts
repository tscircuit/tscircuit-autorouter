import { boundsIntersect } from "./exact-geometry"
import type {
  BoundaryCrossing,
  DynamicRegionGraphSnapshot,
  GlobalTopologyPlan,
  HybridBoundaryContract,
} from "./planning-types"
import type { TypedRouteObject, TypedRoutingProblem } from "./types"

export function negotiateBoundaryContracts({
  problem,
  topologyPlan,
  regionGraph,
}: {
  problem: TypedRoutingProblem
  topologyPlan: GlobalTopologyPlan
  regionGraph: DynamicRegionGraphSnapshot
}): readonly HybridBoundaryContract[] {
  const contracts: HybridBoundaryContract[] = []
  const stableRegions = [...regionGraph.regions].sort((first, second) =>
    first.regionId.localeCompare(second.regionId),
  )
  for (const firstRegion of stableRegions) {
    for (const secondRegionId of firstRegion.neighboringRegionIds) {
      if (firstRegion.regionId >= secondRegionId) continue
      const secondRegion = stableRegions.find(
        (candidate) => candidate.regionId === secondRegionId,
      )
      if (!secondRegion) {
        throw new Error(`region graph references missing neighbor ${secondRegionId}`)
      }
      const crossingEnvelope = Object.freeze({
        minX: Math.max(
          firstRegion.maximumEnvelope.minX,
          secondRegion.maximumEnvelope.minX,
        ),
        maxX: Math.min(
          firstRegion.maximumEnvelope.maxX,
          secondRegion.maximumEnvelope.maxX,
        ),
        minY: Math.max(
          firstRegion.maximumEnvelope.minY,
          secondRegion.maximumEnvelope.minY,
        ),
        maxY: Math.min(
          firstRegion.maximumEnvelope.maxY,
          secondRegion.maximumEnvelope.maxY,
        ),
      })
      if (
        crossingEnvelope.minX >= crossingEnvelope.maxX ||
        crossingEnvelope.minY >= crossingEnvelope.maxY
      ) {
        continue
      }
      const routeObjectIds = [
        ...new Set([
          ...firstRegion.routeObjectIds,
          ...secondRegion.routeObjectIds,
        ]),
      ].sort()
      const crossings = routeObjectIds
        .flatMap((routeObjectId) => {
          const routeObject = problem.routeObjects.find(
            (candidate) => candidate.routeObjectId === routeObjectId,
          )
          const routePlan = topologyPlan.routeObjectPlans.find(
            (candidate) => candidate.routeObjectId === routeObjectId,
          )
          if (!routeObject || !routePlan) return []
          return routePlan.corridors
            .filter((corridor) =>
              boundsIntersect({
                first: corridor.bounds,
                second: crossingEnvelope,
              }),
            )
            .map((corridor) => {
              const connection = problem.compiledRules.connections.find(
                (candidate) =>
                  candidate.connectionName === corridor.connectionName,
              )
              const ownership = problem.ownershipByConnection.find(
                (candidate) =>
                  candidate.connectionName === corridor.connectionName,
              )
              if (!connection || !ownership) {
                throw new Error(
                  `boundary crossing cannot resolve ${corridor.connectionName}`,
                )
              }
              const crossing: Omit<BoundaryCrossing, "order"> = {
                connectionName: corridor.connectionName,
                ownerRouteObjectId: ownership.ownerRouteObjectId,
                permittedLayers: Object.freeze([...connection.allowedLayers]),
                entryDirection: getEntryDirection(corridor),
                grouping: getGrouping(routeObject),
              }
              return crossing
            })
        })
        .sort(
          (first, second) =>
            getGroupingPriority(first.grouping) -
              getGroupingPriority(second.grouping) ||
            first.connectionName.localeCompare(second.connectionName) ||
            first.ownerRouteObjectId.localeCompare(second.ownerRouteObjectId),
        )
        .map((crossing, order) => Object.freeze({ ...crossing, order }))
      const legalReserveMm = deriveLegalReserve({
        problem,
        routeObjectIds,
      })
      contracts.push(
        Object.freeze({
          contractId: `boundary:${firstRegion.regionId}:${secondRegion.regionId}`,
          firstRegionId: firstRegion.regionId,
          secondRegionId: secondRegion.regionId,
          version: regionGraph.graphVersion,
          crossingEnvelope,
          legalReserveMm,
          crossings: Object.freeze(crossings),
        }),
      )
    }
  }
  return Object.freeze(contracts)
}

function getEntryDirection(
  corridor: GlobalTopologyPlan["routeObjectPlans"][number]["corridors"][number],
): BoundaryCrossing["entryDirection"] {
  const dx = Math.abs(corridor.end.x - corridor.start.x)
  const dy = Math.abs(corridor.end.y - corridor.start.y)
  if (dx === dy) return "any"
  return dx > dy ? "horizontal" : "vertical"
}

function getGrouping(
  routeObject: TypedRouteObject,
): BoundaryCrossing["grouping"] {
  if (routeObject.kind === "differential_pair") return "differential_pair"
  if (routeObject.kind === "bus") return "bus"
  if (routeObject.kind === "power") return "power"
  return "single"
}

function getGroupingPriority(grouping: BoundaryCrossing["grouping"]): number {
  if (grouping === "differential_pair") return 0
  if (grouping === "bus") return 1
  if (grouping === "power") return 2
  return 3
}

function deriveLegalReserve({
  problem,
  routeObjectIds,
}: {
  problem: TypedRoutingProblem
  routeObjectIds: readonly string[]
}): number {
  const routeObjects = routeObjectIds
    .map((routeObjectId) =>
      problem.routeObjects.find(
        (candidate) => candidate.routeObjectId === routeObjectId,
      ),
    )
    .filter((routeObject): routeObject is TypedRouteObject => Boolean(routeObject))
  const connectionNames = new Set(
    routeObjects.flatMap((routeObject) =>
      routeObject.ownership.connectionNames,
    ),
  )
  const maximumTraceWidth = Math.max(
    0,
    ...problem.compiledRules.connections
      .filter((connection) => connectionNames.has(connection.connectionName))
      .map((connection) => connection.traceWidthMm),
  )
  const maximumCoupledReserve = Math.max(
    0,
    ...routeObjects.map((routeObject) => {
      if (routeObject.kind === "differential_pair") {
        return routeObject.rules.spacingMm + maximumTraceWidth
      }
      if (routeObject.kind === "bus") {
        return (
          routeObject.members.length *
          (maximumTraceWidth +
            problem.compiledRules.clearances.traceToTraceMm)
        )
      }
      return 0
    }),
  )
  return Math.max(
    maximumTraceWidth +
      2 * problem.compiledRules.clearances.traceToTraceMm +
      maximumCoupledReserve,
    problem.compiledRules.viaPadDiameterMm +
      2 * problem.compiledRules.clearances.viaToTraceEdgeMm,
    problem.compiledRules.routingResolutionMm * 4,
  )
}
