import { boundsIntersect } from "./exact-geometry"
import type {
  DynamicRegionGraphSnapshot,
  DynamicRoutingRegion,
  GlobalTopologyPlan,
} from "./planning-types"
import type {
  CompiledRoutingRules,
  TypedRoutingProblem,
} from "./types"

export class DynamicRegionGraph {
  private readonly problem: TypedRoutingProblem
  private readonly topologyPlan: GlobalTopologyPlan
  private readonly maximumRegionCount: number
  private readonly maximumMutationCount: number
  private readonly maximumMergeRegionCount: number
  private regions: readonly DynamicRoutingRegion[]
  private graphVersion = 0
  private splitCount = 0
  private mergeCount = 0

  constructor({
    problem,
    topologyPlan,
    maximumRegionCount,
    maximumMutationCount,
    maximumMergeRegionCount,
  }: {
    problem: TypedRoutingProblem
    topologyPlan: GlobalTopologyPlan
    maximumRegionCount: number
    maximumMutationCount: number
    maximumMergeRegionCount: number
  }) {
    validatePositiveBound({ value: maximumRegionCount, name: "maximumRegionCount" })
    validatePositiveBound({ value: maximumMutationCount, name: "maximumMutationCount" })
    validatePositiveBound({
      value: maximumMergeRegionCount,
      name: "maximumMergeRegionCount",
    })
    this.problem = problem
    this.topologyPlan = topologyPlan
    this.maximumRegionCount = maximumRegionCount
    this.maximumMutationCount = maximumMutationCount
    this.maximumMergeRegionCount = maximumMergeRegionCount
    if (topologyPlan.routeObjectPlans.length > maximumRegionCount) {
      throw new Error(
        `global plan requires ${topologyPlan.routeObjectPlans.length} regions, exceeding bound ${maximumRegionCount}`,
      )
    }
    this.regions = this.rebuildEdges(
      topologyPlan.routeObjectPlans.map((routePlan, routeIndex) =>
        createRegion({
          problem,
          routePlan,
          regionId: `region:${routeIndex}:${routePlan.routeObjectId}`,
          mutationGeneration: 0,
        }),
      ),
    )
  }

  getSnapshot(): DynamicRegionGraphSnapshot {
    return Object.freeze({
      graphVersion: this.graphVersion,
      regions: freezeList(this.regions),
      splitCount: this.splitCount,
      mergeCount: this.mergeCount,
    })
  }

  getSeamDrivenClusters(): readonly (readonly string[])[] {
    const clusters: string[][] = []
    const visited = new Set<string>()
    for (const region of this.regions) {
      if (visited.has(region.regionId)) continue
      const sharedCopperNeighbors = region.neighboringRegionIds.filter(
        (neighborId) => {
          const neighbor = this.regions.find(
            (candidate) => candidate.regionId === neighborId,
          )
          return neighbor?.ownedPreloadedCopperIds.some((copperId) =>
            region.ownedPreloadedCopperIds.includes(copperId),
          )
        },
      )
      if (sharedCopperNeighbors.length === 0) continue
      const cluster = [region.regionId, ...sharedCopperNeighbors].sort()
      for (const regionId of cluster) visited.add(regionId)
      clusters.push(cluster)
    }
    return freezeList(clusters.map((cluster) => freezeList(cluster)))
  }

  splitRegion({
    regionId,
  }: {
    regionId: string
  }): DynamicRegionGraphSnapshot {
    this.assertMutationAvailable()
    if (this.regions.length + 1 > this.maximumRegionCount) {
      throw new Error("dynamic region split would exceed maximumRegionCount")
    }
    const region = this.regions.find((candidate) => candidate.regionId === regionId)
    if (!region) throw new Error(`cannot split unknown region ${regionId}`)
    if (region.routeObjectIds.length < 2) {
      throw new Error(`region ${regionId} has no independent route-object split`)
    }
    const sortedRouteObjectIds = [...region.routeObjectIds].sort()
    const splitIndex = Math.ceil(sortedRouteObjectIds.length / 2)
    const firstIds = sortedRouteObjectIds.slice(0, splitIndex)
    const secondIds = sortedRouteObjectIds.slice(splitIndex)
    const retained = this.regions.filter(
      (candidate) => candidate.regionId !== regionId,
    )
    const replacements = [firstIds, secondIds].map((routeObjectIds, index) =>
      createMergedRegion({
        problem: this.problem,
        topologyPlan: this.topologyPlan,
        regions: [region],
        routeObjectIds,
        regionId: `${regionId}:split:${this.graphVersion + 1}:${index}`,
        mutationGeneration: region.mutationGeneration + 1,
      }),
    )
    this.regions = this.rebuildEdges([...retained, ...replacements])
    this.graphVersion += 1
    this.splitCount += 1
    return this.getSnapshot()
  }

  mergeConnectionCluster({
    regionIds,
    failingConnectionNames,
  }: {
    regionIds: readonly string[]
    failingConnectionNames: readonly string[]
  }): DynamicRegionGraphSnapshot {
    this.assertMutationAvailable()
    const uniqueRegionIds = [...new Set(regionIds)].sort()
    if (uniqueRegionIds.length < 2) {
      throw new Error("a recovery merge requires at least two regions")
    }
    if (uniqueRegionIds.length > this.maximumMergeRegionCount) {
      throw new Error(
        `recovery merge of ${uniqueRegionIds.length} regions exceeds bound ${this.maximumMergeRegionCount}`,
      )
    }
    if (
      this.regions.length > 1 &&
      uniqueRegionIds.length === this.regions.length
    ) {
      throw new Error("recovery may not merge the complete board region graph")
    }
    const selectedRegions = uniqueRegionIds.map((regionId) => {
      const region = this.regions.find(
        (candidate) => candidate.regionId === regionId,
      )
      if (!region) throw new Error(`cannot merge unknown region ${regionId}`)
      return region
    })
    const selectedConnections = new Set(
      selectedRegions.flatMap((region) => region.connectionNames),
    )
    if (
      failingConnectionNames.length === 0 ||
      failingConnectionNames.some(
        (connectionName) => !selectedConnections.has(connectionName),
      )
    ) {
      throw new Error(
        "recovery merge must name a nonempty failing connection cluster owned by the selected regions",
      )
    }
    const mergedRegion = createMergedRegion({
      problem: this.problem,
      topologyPlan: this.topologyPlan,
      regions: selectedRegions,
      routeObjectIds: selectedRegions.flatMap(
        (region) => region.routeObjectIds,
      ),
      regionId: `region:merge:${this.graphVersion + 1}:${uniqueRegionIds.join("+")}`,
      mutationGeneration:
        Math.max(...selectedRegions.map((region) => region.mutationGeneration)) + 1,
    })
    this.regions = this.rebuildEdges([
      ...this.regions.filter(
        (region) => !uniqueRegionIds.includes(region.regionId),
      ),
      mergedRegion,
    ])
    this.graphVersion += 1
    this.mergeCount += 1
    return this.getSnapshot()
  }

  private rebuildEdges(
    regions: readonly DynamicRoutingRegion[],
  ): readonly DynamicRoutingRegion[] {
    const stableRegions = [...regions].sort((first, second) =>
      first.regionId.localeCompare(second.regionId),
    )
    return freezeList(
      stableRegions.map((region) => {
        const neighbors = stableRegions
          .filter(
            (candidate) =>
              candidate.regionId !== region.regionId &&
              boundsIntersect({
                first: region.maximumEnvelope,
                second: candidate.maximumEnvelope,
              }),
          )
          .map((candidate) => candidate.regionId)
        const conflicts = stableRegions
          .filter(
            (candidate) =>
              candidate.regionId !== region.regionId &&
              (boundsIntersect({ first: region.bounds, second: candidate.bounds }) ||
                candidate.ownedPreloadedCopperIds.some((copperId) =>
                  region.ownedPreloadedCopperIds.includes(copperId),
                )),
          )
          .map((candidate) => candidate.regionId)
        const dependencies = stableRegions
          .filter(
            (candidate) =>
              candidate.regionId < region.regionId &&
              candidate.ownedPreloadedCopperIds.some((copperId) =>
                region.ownedPreloadedCopperIds.includes(copperId),
              ),
          )
          .map((candidate) => candidate.regionId)
        return Object.freeze({
          ...region,
          neighboringRegionIds: freezeList(neighbors),
          conflictRegionIds: freezeList(conflicts),
          dependencyRegionIds: freezeList(dependencies),
        })
      }),
    )
  }

  private assertMutationAvailable(): void {
    if (this.splitCount + this.mergeCount >= this.maximumMutationCount) {
      throw new Error(
        `dynamic region graph exhausted mutation bound ${this.maximumMutationCount}`,
      )
    }
  }
}

function createRegion({
  problem,
  routePlan,
  regionId,
  mutationGeneration,
}: {
  problem: TypedRoutingProblem
  routePlan: GlobalTopologyPlan["routeObjectPlans"][number]
  regionId: string
  mutationGeneration: number
}): DynamicRoutingRegion {
  const bounds = getCorridorUnionBounds({
    routePlans: [routePlan],
    compiledRules: problem.compiledRules,
  })
  const overlapReserveMm = getOverlapReserve(problem.compiledRules)
  return Object.freeze({
    regionId,
    routeObjectIds: freezeList([routePlan.routeObjectId]),
    connectionNames: freezeList(routePlan.connectionNames),
    ownedPreloadedCopperIds: getOwnedPreloadedCopperIds({
      problem,
      connectionNames: routePlan.connectionNames,
    }),
    bounds,
    maximumEnvelope: expandAndClampBounds({
      bounds,
      expansionMm: overlapReserveMm * 3,
      boardBounds: problem.compiledRules.boardBounds,
    }),
    overlapReserveMm,
    neighboringRegionIds: freezeList([]),
    dependencyRegionIds: freezeList([]),
    conflictRegionIds: freezeList([]),
    criticality: routePlan.criticality,
    congestionPressure: routePlan.corridors.reduce(
      (total, corridor) => total + corridor.congestionPressure,
      0,
    ),
    estimatedSolverWork: routePlan.estimatedSolverWork,
    estimatedMemoryBytes: routePlan.estimatedMemoryBytes,
    mutationGeneration,
  })
}

function createMergedRegion({
  problem,
  topologyPlan,
  regions,
  routeObjectIds,
  regionId,
  mutationGeneration,
}: {
  problem: TypedRoutingProblem
  topologyPlan: GlobalTopologyPlan
  regions: readonly DynamicRoutingRegion[]
  routeObjectIds: readonly string[]
  regionId: string
  mutationGeneration: number
}): DynamicRoutingRegion {
  const uniqueRouteObjectIds = [...new Set(routeObjectIds)].sort()
  const routePlans = uniqueRouteObjectIds.map((routeObjectId) => {
    const routePlan = topologyPlan.routeObjectPlans.find(
      (candidate) => candidate.routeObjectId === routeObjectId,
    )
    if (!routePlan) throw new Error(`missing route plan ${routeObjectId}`)
    return routePlan
  })
  const bounds = getCorridorUnionBounds({
    routePlans,
    compiledRules: problem.compiledRules,
  })
  const overlapReserveMm = Math.max(
    ...regions.map((region) => region.overlapReserveMm),
  )
  return Object.freeze({
    regionId,
    routeObjectIds: freezeList(uniqueRouteObjectIds),
    connectionNames: freezeList([
      ...new Set(routePlans.flatMap((plan) => plan.connectionNames)),
    ]),
    ownedPreloadedCopperIds: freezeList([
      ...new Set(regions.flatMap((region) => region.ownedPreloadedCopperIds)),
    ]),
    bounds,
    maximumEnvelope: expandAndClampBounds({
      bounds,
      expansionMm: overlapReserveMm * 3,
      boardBounds: problem.compiledRules.boardBounds,
    }),
    overlapReserveMm,
    neighboringRegionIds: freezeList([]),
    dependencyRegionIds: freezeList([]),
    conflictRegionIds: freezeList([]),
    criticality: Math.max(...routePlans.map((plan) => plan.criticality)),
    congestionPressure: routePlans.reduce(
      (total, plan) =>
        total +
        plan.corridors.reduce(
          (corridorTotal, corridor) =>
            corridorTotal + corridor.congestionPressure,
          0,
        ),
      0,
    ),
    estimatedSolverWork: routePlans.reduce(
      (total, plan) => total + plan.estimatedSolverWork,
      0,
    ),
    estimatedMemoryBytes: routePlans.reduce(
      (total, plan) => total + plan.estimatedMemoryBytes,
      0,
    ),
    mutationGeneration,
  })
}

function getCorridorUnionBounds({
  routePlans,
  compiledRules,
}: {
  routePlans: readonly GlobalTopologyPlan["routeObjectPlans"][number][]
  compiledRules: CompiledRoutingRules
}): DynamicRoutingRegion["bounds"] {
  const corridors = routePlans.flatMap((plan) => plan.corridors)
  if (corridors.length === 0) return compiledRules.boardBounds
  return Object.freeze({
    minX: Math.max(
      compiledRules.boardBounds.minX,
      Math.min(...corridors.map((corridor) => corridor.bounds.minX)),
    ),
    maxX: Math.min(
      compiledRules.boardBounds.maxX,
      Math.max(...corridors.map((corridor) => corridor.bounds.maxX)),
    ),
    minY: Math.max(
      compiledRules.boardBounds.minY,
      Math.min(...corridors.map((corridor) => corridor.bounds.minY)),
    ),
    maxY: Math.min(
      compiledRules.boardBounds.maxY,
      Math.max(...corridors.map((corridor) => corridor.bounds.maxY)),
    ),
  })
}

function getOverlapReserve(compiledRules: CompiledRoutingRules): number {
  const maximumTraceWidth = Math.max(
    ...compiledRules.connections.map((connection) => connection.traceWidthMm),
  )
  return Math.max(
    maximumTraceWidth + 2 * compiledRules.clearances.traceToTraceMm,
    compiledRules.viaPadDiameterMm +
      2 * compiledRules.clearances.viaToTraceEdgeMm,
    compiledRules.routingResolutionMm * 4,
  )
}

function getOwnedPreloadedCopperIds({
  problem,
  connectionNames,
}: {
  problem: TypedRoutingProblem
  connectionNames: readonly string[]
}): readonly string[] {
  return freezeList(
    problem.compiledRules.preloadedCopper
      .filter(
        (copper) =>
          copper.mutability === "mutable" &&
          copper.ownerConnectionNames.some((connectionName) =>
            connectionNames.includes(connectionName),
          ),
      )
      .map((copper) => copper.trace.pcb_trace_id)
      .sort(),
  )
}

function expandAndClampBounds({
  bounds,
  expansionMm,
  boardBounds,
}: {
  bounds: DynamicRoutingRegion["bounds"]
  expansionMm: number
  boardBounds: DynamicRoutingRegion["bounds"]
}): DynamicRoutingRegion["bounds"] {
  return Object.freeze({
    minX: Math.max(boardBounds.minX, bounds.minX - expansionMm),
    maxX: Math.min(boardBounds.maxX, bounds.maxX + expansionMm),
    minY: Math.max(boardBounds.minY, bounds.minY - expansionMm),
    maxY: Math.min(boardBounds.maxY, bounds.maxY + expansionMm),
  })
}

function validatePositiveBound({
  value,
  name,
}: {
  value: number
  name: string
}): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`)
  }
}

function freezeList<Item>(items: readonly Item[]): readonly Item[] {
  return Object.freeze([...items])
}
