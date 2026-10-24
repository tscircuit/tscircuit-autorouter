import {
  SelectiveReripTinyHyperGraphSolver,
  TinyHyperGraphSolver,
  type TinyHyperGraphSolverOptions,
  type DistinctOwnerBlockerHop,
  type DistinctOwnerBlockerSearchResult,
} from "tiny-hypergraph/lib/index"
import { findLazyMinimumOwnerRelease } from "./findLazyMinimumOwnerRelease"
import { GLOBAL_OWNER_DISTANCE_LABEL_LIMIT } from "./findGlobalOwnerBoundedDistance"

type State = { portId: number; nextRegionId: number }
type Hop = DistinctOwnerBlockerHop<State, number, unknown>
type Result = DistinctOwnerBlockerSearchResult<State, number, unknown>
type NativeAccess = {
  state: { currentRouteId?: number; currentRouteNetId?: number }
  findRelaxedBlockerPath(forbidden?: ReadonlySet<number>): Result
  getRouteStartPortId(route: number): number
  getRouteEndPortId(route: number): number
  getStartingNextRegionId(route: number, port: number): number | undefined
  getHopId(port: number, region: number): number
  getPortOwners(): ReadonlyMap<number, ReadonlySet<number>>
  getRelaxedSearchHops(params: {
    state: State; goalPortId: number; routeNetId: number
    portOwners: ReadonlyMap<number, ReadonlySet<number>>
    portResources: Map<number, unknown>; hopTemplatesByRegion: Map<number, Hop[]>
    forbiddenOwnerRouteIds: ReadonlySet<number>; buildRegionTemplates?: boolean
  }): Hop[]
  createGreedyFinalRouteSolver(options: TinyHyperGraphSolverOptions, attempt: number): TinyHyperGraphSolver
}

export type LazyOwnerReleaseController = {
  stats: Record<string, number>
  install(solver: TinyHyperGraphSolver): void
}

/**
 * Owned native hook only. Native topology/reservations/forbidden/hard crossing
 * resources stay authoritative; all model creation is fresh inside each call.
 * UNKNOWN is returned to the existing native budget-response/rerip policy. This
 * controller never calls the old owner-release search to obtain another answer.
 * Explicit global-minimum mode preserves the lexicographic owner/distance
 * objective. Exact native witness ties and queue trajectories are not promised.
 */
export function createLazyOwnerReleaseController(maxWorkUnits = 300000000): LazyOwnerReleaseController {
  if (!Number.isSafeInteger(maxWorkUnits) || maxWorkUnits < 0) throw new Error("Lazy owner work cap must be finite nonnegative integer")
  const installed = new WeakSet<TinyHyperGraphSolver>()
  const prototype = SelectiveReripTinyHyperGraphSolver.prototype as unknown as NativeAccess
  const stats: Record<string, number> = {
    lazyOwnerRelease_enabled: 1, lazyOwnerRelease_maxWorkUnitsPerQuery: maxWorkUnits,
    lazyOwnerRelease_pairDomainMaxBytes: 4 * 1024 * 1024,
    lazyOwnerRelease_installedSelectiveSolvers: 0, lazyOwnerRelease_queries: 0,
    lazyOwnerRelease_found: 0, lazyOwnerRelease_unknown: 0, lazyOwnerRelease_noPath: 0,
    lazyOwnerRelease_globalObjectiveProven: 0,
    lazyOwnerRelease_globalDistanceTieOptimized: 1, lazyOwnerRelease_oldSearchCalls: 0,
    lazyOwnerRelease_globalLabelLimit: GLOBAL_OWNER_DISTANCE_LABEL_LIMIT,
    lazyOwnerRelease_coldOwnerScans: 0, lazyOwnerRelease_coldPortOwnerEntries: 0,
    lazyOwnerRelease_nativeHopFactoryCalls: 0, lazyOwnerRelease_nativeMaterializedHopOccurrences: 0,
    lazyOwnerRelease_portResourceEntries: 0, lazyOwnerRelease_regionTemplateEntries: 0,
  }
  const install = (solver: TinyHyperGraphSolver): void => {
    if (installed.has(solver)) return
    if (!(solver instanceof TinyHyperGraphSolver)) throw new Error("Lazy owner hook requires its owned native Tiny solver module")
    const access = solver as unknown as NativeAccess
    if (solver instanceof SelectiveReripTinyHyperGraphSolver) {
      const authority = ["findRelaxedBlockerPath", "getRouteStartPortId", "getRouteEndPortId", "getStartingNextRegionId",
        "getHopId", "getPortOwners", "getRelaxedSearchHops"] as const
      for (const method of authority) {
        if (access[method] !== prototype[method]) throw new Error(`Lazy owner release does not support custom native authority: ${method}`)
      }
      stats.lazyOwnerRelease_installedSelectiveSolvers++
      access.findRelaxedBlockerPath = (forbidden = new Set<number>()): Result => {
        for (const method of authority) {
          if (method !== "findRelaxedBlockerPath" && access[method] !== prototype[method]) {
            throw new Error(`Lazy owner release native authority changed after installation: ${method}`)
          }
        }
        stats.lazyOwnerRelease_queries++
        const route = access.state.currentRouteId, net = access.state.currentRouteNetId
        if (route === undefined || net === undefined) throw new Error("Lazy native release query has no current route/net")
        const start = access.getRouteStartPortId(route), goal = access.getRouteEndPortId(route)
        const region = access.getStartingNextRegionId(route, start)
        if (region === undefined) throw new Error("Lazy native release query has no directed starting incidence")
        const portOwners = access.getPortOwners(), portResources = new Map<number, unknown>()
        const hopTemplatesByRegion = new Map<number, Hop[]>()
        stats.lazyOwnerRelease_coldOwnerScans++
        stats.lazyOwnerRelease_coldPortOwnerEntries += portOwners.size
        const answer = findLazyMinimumOwnerRelease({ start: { portId: start, nextRegionId: region },
          getStateKey: (state: State): number => access.getHopId(state.portId, state.nextRegionId),
          isGoal: (state: State): boolean => state.portId === goal,
          getHops: (state: State): Hop[] => {
            const hops = access.getRelaxedSearchHops({ state, goalPortId: goal, routeNetId: net,
              portOwners, portResources, hopTemplatesByRegion, forbiddenOwnerRouteIds: forbidden })
            stats.lazyOwnerRelease_nativeHopFactoryCalls++
            stats.lazyOwnerRelease_nativeMaterializedHopOccurrences += hops.length
            return hops
          }, maxWorkUnits, distancePolicy: "global-minimum" })
        stats.lazyOwnerRelease_portResourceEntries += portResources.size
        stats.lazyOwnerRelease_regionTemplateEntries += hopTemplatesByRegion.size
        for (const [key, value] of Object.entries(answer.work)) {
          const name = `lazyOwnerRelease_${key}`
          stats[name] = key === "pairPeakRetainedBytes" || key.startsWith("globalPeak") ? Math.max(stats[name] ?? 0, value) : (stats[name] ?? 0) + value
        }
        if (answer.result.found) {
          if (!answer.ownerMinimumProven || !answer.chosenSetDistanceMinimumProven || !answer.globalDistanceMinimumProven) {
            throw new Error("Lazy owner search returned an invalid changed-policy certificate")
          }
          stats.lazyOwnerRelease_found++
          stats.lazyOwnerRelease_globalObjectiveProven++
        } else if (answer.result.reason === "expansion_limit") stats.lazyOwnerRelease_unknown++
        else stats.lazyOwnerRelease_noPath++
        return answer.result
      }
    }
    // Native final-acceptance can construct and synchronously solve a selective
    // congestion-aware child within one parent step. Install before returning
    // that child to its caller; polling activeSubSolver alone would miss it.
    const factory = access.createGreedyFinalRouteSolver
    access.createGreedyFinalRouteSolver = (options, attempt): TinyHyperGraphSolver => {
      const child = factory.call(solver, options, attempt)
      install(child)
      return child
    }
    installed.add(solver)
  }
  return { stats, install }
}
