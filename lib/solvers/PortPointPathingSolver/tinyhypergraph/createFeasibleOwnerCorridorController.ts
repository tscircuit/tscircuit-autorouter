import {
  SelectiveReripTinyHyperGraphSolver, TinyHyperGraphSolver,
  type TinyHyperGraphSolverOptions, type DistinctOwnerBlockerHop,
  type DistinctOwnerBlockerSearchResult,
} from "tiny-hypergraph/lib/index"
import { findFeasibleOwnerCorridor, FEASIBLE_OWNER_WORK_LIMIT, FEASIBLE_OWNER_LABEL_LIMIT } from "./findFeasibleOwnerCorridor"

type State = { portId: number; nextRegionId: number }
type Hop = DistinctOwnerBlockerHop<State, number, unknown>
type Result = DistinctOwnerBlockerSearchResult<State, number, unknown>
type NativeAccess = {
  state: { currentRouteId?: number; currentRouteNetId?: number
    regionSegments: [number, number, number][][]; regionCongestionCost: Float64Array }
  routeAttemptCountByRouteId: Uint32Array
  routeSuccessCountByRouteId: Uint32Array
  findRelaxedBlockerPath(forbidden?: ReadonlySet<number>): Result
  getRouteStartPortId(route: number): number
  getRouteEndPortId(route: number): number
  getStartingNextRegionId(route: number, port: number): number | undefined
  getHopId(port: number, region: number): number
  getPortOwners(): ReadonlyMap<number, ReadonlySet<number>>
  getRelaxedSearchExpansionLimit(): number
  getRelaxedSearchHops(params: {
    state: State; goalPortId: number; routeNetId: number
    portOwners: ReadonlyMap<number, ReadonlySet<number>>
    portResources: Map<number, unknown>; hopTemplatesByRegion: Map<number, Hop[]>
    forbiddenOwnerRouteIds: ReadonlySet<number>; buildRegionTemplates?: boolean
  }): Hop[]
  createGreedyFinalRouteSolver(options: TinyHyperGraphSolverOptions, attempt: number): TinyHyperGraphSolver
}
type NativeTelemetryRecord = { solver: WeakRef<TinyHyperGraphSolver>; iterations: number; attempts: number; successes: number }
type OwnerFeature = { segments: number; pressure: number }
export type FeasibleOwnerCorridorController = {
  stats: { [key: string]: number }
  install(solver: TinyHyperGraphSolver): void
  getStats(): { [key: string]: number }
}

/**
 * Owned native policy only. Fresh native hard-hop resources remain authority;
 * only the choice of releasable owners changes. No call to the old exact search
 * obtains an answer. One generated corridor + one fixed-owner refinement share
 * the original native expansion cap and a300M charged work cap.
 *
 * Owner work estimate=1+committed segment count+sum(min(4,region pressure))
 * +prior native attempt count. It is a deterministic proxy, not predicted HD CPU.
 * Actual subsequent ordinary work is observed using existing iteration/attempt
 * counters at cold queries, completed solve calls and benchmark snapshots.
 */
export function createFeasibleOwnerCorridorController(
  maxWorkUnits = FEASIBLE_OWNER_WORK_LIMIT,
): FeasibleOwnerCorridorController {
  if (!Number.isSafeInteger(maxWorkUnits) || maxWorkUnits < 0 || maxWorkUnits > FEASIBLE_OWNER_WORK_LIMIT) {
    throw new Error("Feasible owner controller cannot raise its fixed work cap")
  }
  const installed = new WeakSet<TinyHyperGraphSolver>(), records: NativeTelemetryRecord[] = []
  const prototype = SelectiveReripTinyHyperGraphSolver.prototype as unknown as NativeAccess
  const stats: { [key: string]: number } = {
    feasibleOwner_enabled: 1, feasibleOwner_workLimitPerQuery: maxWorkUnits,
    feasibleOwner_labelLimitPerQuery: FEASIBLE_OWNER_LABEL_LIMIT,
    feasibleOwner_changedObjective: 1, feasibleOwner_generatorCountPerQuery: 1, feasibleOwner_installedSelectiveSolvers: 0,
    feasibleOwner_queries: 0, feasibleOwner_found: 0, feasibleOwner_unknown: 0,
    feasibleOwner_noPath: 0, feasibleOwner_oldSearchCalls: 0,
    feasibleOwner_selectedOwnerCount: 0, feasibleOwner_selectedOwnerWork: 0,
    feasibleOwner_selectedScore: 0, feasibleOwner_selectedNativeSegments: 0,
    feasibleOwner_coldOwnerScans: 0, feasibleOwner_coldOwnerEntries: 0,
    feasibleOwner_expansionPolicyPortReads: 0, feasibleOwner_nativeAuthorityChecks: 0,
    feasibleOwner_coldSizingRegionReads: 0, feasibleOwner_coldSizingLimitQueries: 0,
    feasibleOwner_coldSizingLimitWork: 0,
    feasibleOwner_featureRegionReads: 0, feasibleOwner_featureSegmentReads: 0,
    feasibleOwner_nativeFactoryCalls: 0, feasibleOwner_nativeMaterializedHopOccurrences: 0,
    feasibleOwner_nativeTemplateMaterializedHops: 0, feasibleOwner_nativeDestinationVisitUpperBound: 0,
    feasibleOwner_nativeObservedSolverIterations: 0, feasibleOwner_nativeObservedRouteAttempts: 0,
    feasibleOwner_nativeObservedRouteSuccesses: 0, feasibleOwner_telemetryArrayReads: 0,
  }
  const observe = (solver: TinyHyperGraphSolver, record: NativeTelemetryRecord): void => {
    const access = solver as unknown as NativeAccess
    if (solver.iterations < record.iterations) throw new Error("Feasible owner telemetry does not support a reset owned solver")
    if (solver.iterations === record.iterations) return
    stats.feasibleOwner_nativeObservedSolverIterations += solver.iterations - record.iterations
    record.iterations = solver.iterations
    let attempts = 0, successes = 0
    for (const value of access.routeAttemptCountByRouteId) attempts += value
    for (const value of access.routeSuccessCountByRouteId) successes += value
    stats.feasibleOwner_telemetryArrayReads += access.routeAttemptCountByRouteId.length + access.routeSuccessCountByRouteId.length
    if (attempts < record.attempts || successes < record.successes) throw new Error("Owned route counters reset during feasible corridor policy")
    stats.feasibleOwner_nativeObservedRouteAttempts += attempts - record.attempts
    stats.feasibleOwner_nativeObservedRouteSuccesses += successes - record.successes
    record.attempts = attempts; record.successes = successes
  }
  const install = (solver: TinyHyperGraphSolver): void => {
    if (installed.has(solver)) return
    if (!(solver instanceof TinyHyperGraphSolver)) throw new Error("Feasible corridor hook requires its owned native Tiny module")
    const access = solver as unknown as NativeAccess
    const record: NativeTelemetryRecord = { solver: new WeakRef(solver), iterations: 0, attempts: 0, successes: 0 }
    records.push(record)
    if (solver instanceof SelectiveReripTinyHyperGraphSolver) {
      const authority = ["findRelaxedBlockerPath", "getRouteStartPortId", "getRouteEndPortId", "getStartingNextRegionId",
        "getHopId", "getPortOwners", "getRelaxedSearchHops", "getRelaxedSearchExpansionLimit",
        "getHopBlockerResources", "getHardBlockedCrossingOwners", "segmentsCrossOnSameLayer",
        "populateSegmentGeometryScratch", "isKnownSingleLayerRegion", "isRegionReservedForDifferentNet",
        "isPortReservedForDifferentNet"] as const
      const raw = solver as unknown as Record<string, unknown>
      const rawPrototype = prototype as unknown as Record<string, unknown>
      for (const method of authority) {
        if (raw[method] !== rawPrototype[method]) throw new Error(`Feasible corridor does not support custom native authority: ${method}`)
      }
      stats.feasibleOwner_installedSelectiveSolvers++
      access.findRelaxedBlockerPath = (forbidden = new Set<number>()): Result => {
        for (const method of authority) {
          stats.feasibleOwner_nativeAuthorityChecks++
          if (method !== "findRelaxedBlockerPath" && raw[method] !== rawPrototype[method]) {
            throw new Error(`Feasible corridor native authority changed: ${method}`)
          }
        }
        observe(solver, record)
        stats.feasibleOwner_queries++
        const route = access.state.currentRouteId, net = access.state.currentRouteNetId
        if (route === undefined || net === undefined) throw new Error("Feasible corridor query has no current route/net")
        const start = access.getRouteStartPortId(route), goal = access.getRouteEndPortId(route)
        const region = access.getStartingNextRegionId(route, start)
        if (region === undefined) throw new Error("Feasible corridor query has no native starting incidence")
        let segments = 0
        for (const list of access.state.regionSegments) {
          stats.feasibleOwner_coldSizingRegionReads++
          segments += list.length
        }
        const expansionPolicyReads = solver.topology.incidentPortRegion.length
        const setupBound = 2 * access.state.regionSegments.length + 7 * segments + 2 * solver.problem.routeCount + expansionPolicyReads
        if (!Number.isSafeInteger(setupBound)) throw new Error("Feasible owner cold setup exceeds finite accounting")
        if (setupBound > maxWorkUnits) {
          stats.feasibleOwner_unknown++
          stats.feasibleOwner_coldSizingLimitQueries++
          stats.feasibleOwner_coldSizingLimitWork += access.state.regionSegments.length
          return { found: false, reason: "expansion_limit", expandedLabelCount: 0 }
        }
        const portOwners = access.getPortOwners(), portResources = new Map<number, unknown>()
        const templates = new Map<number, Hop[]>(), features = new Map<number, OwnerFeature>()
        let maximumPortOwners = 0
        for (const owners of portOwners.values()) maximumPortOwners = Math.max(maximumPortOwners, owners.size)
        for (let index = 0; index < access.state.regionSegments.length; index++) {
          stats.feasibleOwner_featureRegionReads++
          const pressure = access.state.regionCongestionCost[index]!
          if (!Number.isFinite(pressure) || pressure < 0) throw new Error("Native congestion pressure must be finite nonnegative")
          for (const [owner] of access.state.regionSegments[index]!) {
            stats.feasibleOwner_featureSegmentReads++
            let feature = features.get(owner)
            if (!feature) { feature = { segments: 0, pressure: 0 }; features.set(owner, feature) }
            feature.segments++; feature.pressure += Math.min(4, pressure)
          }
        }
        stats.feasibleOwner_coldOwnerScans++
        stats.feasibleOwner_coldOwnerEntries += portOwners.size
        const distanceToGoal = (state: State): number => {
          const dx = solver.topology.portX[state.portId]! - solver.topology.portX[goal]!
          const dy = solver.topology.portY[state.portId]! - solver.topology.portY[goal]!
          const distance = Math.hypot(dx, dy)
          if (!Number.isFinite(distance)) throw new Error("Native owner corridor coordinates must be finite")
          return distance
        }
        stats.feasibleOwner_expansionPolicyPortReads += expansionPolicyReads
        const maxExpandedLabels = access.getRelaxedSearchExpansionLimit()
        const answer = findFeasibleOwnerCorridor({ start: { portId: start, nextRegionId: region },
          getStateKey: (state: State): number => access.getHopId(state.portId, state.nextRegionId),
          isGoal: (state: State): boolean => state.portId === goal,
          getOwnerWork: (owner: number): number => {
            const feature = features.get(owner), attempts = access.routeAttemptCountByRouteId[owner]
            if (!feature || attempts === undefined) throw new Error("Native hard owner has no committed route-work feature")
            const estimate = 1 + feature.segments + feature.pressure + attempts
            if (!Number.isFinite(estimate)) throw new Error("Native reroute-work estimate overflowed")
            return estimate
          },
          getGoalDistance: distanceToGoal,
          distanceScale: Math.max(1, distanceToGoal({ portId: start, nextRegionId: region })),
          maxExpandedLabels, initialWorkUnits: setupBound, maxWorkUnits,
          getHops: (state: State, charge): Hop[] | undefined => {
            const degree = solver.topology.regionIncidentPorts[state.nextRegionId]!.length
            const singleLayer = solver.isKnownSingleLayerRegion(state.nextRegionId)
            const coldTemplate = !singleLayer && !templates.has(state.nextRegionId)
            // Conservative native destination/resource-loop work, charged before
            // opaque native construction. Counts are not CPU-time estimates.
            const segmentOwners = singleLayer ? access.state.regionSegments[state.nextRegionId]!.length : 0
            const resourceOwners = maximumPortOwners + segmentOwners
            // Native resource concatenation uses Array.includes for every owner.
            // Charge its quadratic worst-case comparisons, not only hop visits.
            const resourceLoops = singleLayer || coldTemplate ?
              segmentOwners + maximumPortOwners + resourceOwners * (resourceOwners + 1) : 0
            const bound = 1 + degree * (2 + resourceLoops) + (coldTemplate ? degree : 0)
            if (!charge("nativeFactoryWorkBound", bound)) return undefined
            const hops = access.getRelaxedSearchHops({ state, goalPortId: goal, routeNetId: net,
              portOwners, portResources, hopTemplatesByRegion: templates, forbiddenOwnerRouteIds: forbidden })
            stats.feasibleOwner_nativeFactoryCalls++
            stats.feasibleOwner_nativeMaterializedHopOccurrences += hops.length
            if (singleLayer || coldTemplate) stats.feasibleOwner_nativeDestinationVisitUpperBound += degree
            if (coldTemplate) {
              const created = templates.get(state.nextRegionId)
              // A native reserved current region returns [] before template creation.
              if (created) {
                stats.feasibleOwner_nativeTemplateMaterializedHops += created.length
                stats.feasibleOwner_nativeMaterializedHopOccurrences += created.length
              }
            }
            return hops
          } })
        for (const [key, value] of Object.entries(answer.work)) {
          const name = `feasibleOwner_${key}`
          stats[name] = key === "peakQueueSize" ? Math.max(stats[name] ?? 0, value) : (stats[name] ?? 0) + value
        }
        if (answer.result.found) {
          if (answer.objectiveMinimumProven || !answer.chosenSetDistanceMinimumProven) throw new Error("Feasible owner policy claimed an invalid proof")
          if (answer.result.states[0]!.portId !== start || answer.result.states[0]!.nextRegionId !== region ||
            answer.result.states.at(-1)!.portId !== goal) throw new Error("Native corridor terminal/direction witness changed")
          stats.feasibleOwner_found++
          stats.feasibleOwner_selectedOwnerCount += answer.result.owners.size
          stats.feasibleOwner_selectedOwnerWork += answer.selectedOwnerWork!
          stats.feasibleOwner_selectedScore += answer.selectedScore!
          for (const owner of answer.result.owners) stats.feasibleOwner_selectedNativeSegments += features.get(owner)!.segments
        } else if (answer.result.reason === "expansion_limit") stats.feasibleOwner_unknown++
        else stats.feasibleOwner_noPath++
        return answer.result
      }
    }
    // Synchronous final-route children solve before the parent exposes them.
    const factory = access.createGreedyFinalRouteSolver
    access.createGreedyFinalRouteSolver = (options, attempt): TinyHyperGraphSolver => {
      const child = factory.call(solver, options, attempt)
      install(child)
      return child
    }
    const solve = solver.solve
    solver.solve = (): void => {
      try { solve.call(solver) }
      finally { observe(solver, record) }
    }
    installed.add(solver)
  }
  return { stats, install, getStats: (): { [key: string]: number } => {
    for (const record of records) {
      const solver = record.solver.deref()
      if (solver) observe(solver, record)
    }
    return { ...stats }
  } }
}
