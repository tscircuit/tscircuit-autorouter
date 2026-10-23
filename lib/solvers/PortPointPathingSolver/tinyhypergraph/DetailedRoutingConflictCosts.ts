import type {
  TinyHyperGraphSolver,
  TinyHyperGraphSolverOptions,
} from "tiny-hypergraph/lib/core"
import type { DetailedRoutingRegionPenalty } from "../../../autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9DetailedRoutingFeedback"

type FinalRouteSolverFactory = {
  createGreedyFinalRouteSolver(
    options: TinyHyperGraphSolverOptions,
    attempt: number,
  ): TinyHyperGraphSolver
}

/** Soft, route-owned costs learned from completed detailed routing attempts. */
export class DetailedRoutingConflictCosts {
  readonly stats = {
    detailedConflictConfiguredSolverCount: 0,
    detailedConflictMatchedRouteCount: 0,
    detailedConflictMatchedRegionCount: 0,
    detailedConflictPenaltyApplications: 0,
  }
  private readonly installed = new WeakSet<TinyHyperGraphSolver>()

  constructor(private readonly penalties: readonly DetailedRoutingRegionPenalty[]) {
    for (const penalty of penalties) {
      if (
        !Number.isFinite(penalty.penalty) ||
        penalty.penalty <= 0 ||
        !penalty.connectionName ||
        !penalty.capacityMeshNodeId ||
        !penalty.evidenceKey
      ) {
        throw new Error("Detailed routing costs require owned, finite positive evidence")
      }
    }
  }

  install(solver: TinyHyperGraphSolver): void {
    if (this.installed.has(solver)) return
    this.installed.add(solver)
    const regionIdByNode = new Map<string, number>()
    solver.topology.regionMetadata?.forEach((metadata, regionId) => {
      if (typeof metadata?.capacityMeshNodeId === "string") {
        regionIdByNode.set(metadata.capacityMeshNodeId, regionId)
      }
    })
    const penaltiesByConnection = new Map<string, DetailedRoutingRegionPenalty[]>()
    for (const penalty of this.penalties) {
      const values = penaltiesByConnection.get(penalty.connectionName) ?? []
      values.push(penalty)
      penaltiesByConnection.set(penalty.connectionName, values)
    }
    const regionCostsByRoute = new Map<number, Float64Array>()
    const matchedRegions = new Set<number>()
    for (let routeId = 0; routeId < solver.problem.routeCount; routeId++) {
      const metadata = solver.problem.routeMetadata?.[routeId]
      const connectionName =
        metadata?.simpleRouteConnection?.name ?? metadata?.connectionId
      const penalties = penaltiesByConnection.get(connectionName)
      if (!penalties) continue
      const costs = new Float64Array(solver.topology.regionCount)
      for (const penalty of penalties) {
        const regionId = regionIdByNode.get(penalty.capacityMeshNodeId)
        if (regionId === undefined) continue
        costs[regionId] += penalty.penalty
        matchedRegions.add(regionId)
      }
      regionCostsByRoute.set(routeId, costs)
    }
    if (matchedRegions.size === 0) return
    this.stats.detailedConflictConfiguredSolverCount++
    this.stats.detailedConflictMatchedRouteCount += regionCostsByRoute.size
    this.stats.detailedConflictMatchedRegionCount += matchedRegions.size
    const nativeComputeG = solver.computeG.bind(solver)
    solver.computeG = (candidate, neighborPortId, maximumCost, knownDistance): number => {
      const routeId = solver.state.currentRouteId
      const penalty = routeId === undefined
        ? 0
        : regionCostsByRoute.get(routeId)?.[candidate.nextRegionId] ?? 0
      const cost = nativeComputeG(
        candidate,
        neighborPortId,
        maximumCost === undefined ? undefined : maximumCost - penalty,
        knownDistance,
      )
      if (penalty > 0 && Number.isFinite(cost)) {
        this.stats.detailedConflictPenaltyApplications++
        return cost + penalty
      }
      return cost
    }
    // Final-route attempts are real search instances and use the same evidence.
    const factory = solver as unknown as FinalRouteSolverFactory
    const nativeCreate = factory.createGreedyFinalRouteSolver.bind(solver)
    factory.createGreedyFinalRouteSolver = (options, attempt): TinyHyperGraphSolver => {
      const next = nativeCreate(options, attempt)
      this.install(next)
      return next
    }
  }
}
