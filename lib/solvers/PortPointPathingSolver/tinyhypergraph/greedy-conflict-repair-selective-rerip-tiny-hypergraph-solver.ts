import {
  createEmptyRegionIntersectionCache,
  SelectiveReripTinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/index"

type RouteSegment = [number, number, number]

type GreedyCandidateState = {
  regionSegments: RouteSegment[][]
  regionCongestionCost: Float64Array
  ripCount: number
}

const GREEDY_CONFLICT_REPAIR_CHECKPOINT_FRACTION = 0.1
const MIN_MULTI_OWNER_BLOCKER_COUNT = 2

function segmentsCrossOnKnownSingleLayer(
  solver: SelectiveReripTinyHyperGraphSolver,
  regionId: number,
  firstFromPortId: number,
  firstToPortId: number,
  secondFromPortId: number,
  secondToPortId: number,
): boolean {
  const first = {
    ...solver.populateSegmentGeometryScratch(
      regionId,
      firstFromPortId,
      firstToPortId,
    ),
  }
  const second = {
    ...solver.populateSegmentGeometryScratch(
      regionId,
      secondFromPortId,
      secondToPortId,
    ),
  }
  if ((first.layerMask & second.layerMask) === 0) return false
  if (
    first.lesserAngle === second.lesserAngle ||
    first.lesserAngle === second.greaterAngle ||
    first.greaterAngle === second.lesserAngle ||
    first.greaterAngle === second.greaterAngle
  ) {
    return false
  }
  const secondLesserInsideFirst =
    first.lesserAngle < second.lesserAngle &&
    second.lesserAngle < first.greaterAngle
  const secondGreaterInsideFirst =
    first.lesserAngle < second.greaterAngle &&
    second.greaterAngle < first.greaterAngle
  return secondLesserInsideFirst !== secondGreaterInsideFirst
}

function getRoutesWithIllegalGreedyCrossings(
  solver: SelectiveReripTinyHyperGraphSolver,
): Set<number> {
  const routeIds = new Set<number>()
  for (
    let regionId = 0;
    regionId < solver.state.regionSegments.length;
    regionId++
  ) {
    if (!solver.isKnownSingleLayerRegion(regionId)) continue
    const segments = solver.state.regionSegments[regionId]!
    for (let firstIndex = 0; firstIndex < segments.length; firstIndex++) {
      const [firstRouteId, firstFromPortId, firstToPortId] =
        segments[firstIndex]!
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < segments.length;
        secondIndex++
      ) {
        const [secondRouteId, secondFromPortId, secondToPortId] =
          segments[secondIndex]!
        if (
          solver.problem.routeNet[firstRouteId] ===
          solver.problem.routeNet[secondRouteId]
        ) {
          continue
        }
        if (
          !segmentsCrossOnKnownSingleLayer(
            solver,
            regionId,
            firstFromPortId,
            firstToPortId,
            secondFromPortId,
            secondToPortId,
          )
        ) {
          continue
        }
        routeIds.add(firstRouteId)
        routeIds.add(secondRouteId)
      }
    }
  }
  return routeIds
}

/**
 * Converts an optimistic complete candidate into a strict rerip seed. The
 * greedy candidate is never emitted: every route participating in a crossing
 * that strict routing forbids is removed before routing resumes.
 */
export class GreedyConflictRepairSelectiveReripTinyHyperGraphSolver extends SelectiveReripTinyHyperGraphSolver {
  private greedyConflictRepairPending = false

  private attemptedGreedyConflictRepair = false

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions,
  ) {
    super(topology, problem, options)
  }

  override _step(): void {
    if (
      this.greedyConflictRepairPending &&
      this.iterations >=
        Math.ceil(
          this.MAX_ITERATIONS * GREEDY_CONFLICT_REPAIR_CHECKPOINT_FRACTION,
        )
    ) {
      this.greedyConflictRepairPending = false
      if (this.tryApplyGreedyConflictRepair()) return
    }
    super._step()
  }

  override onOutOfCandidates(): void {
    const checkpointIteration = Math.ceil(
      this.MAX_ITERATIONS * GREEDY_CONFLICT_REPAIR_CHECKPOINT_FRACTION,
    )
    if (
      !this.attemptedGreedyConflictRepair &&
      this.iterations < checkpointIteration
    ) {
      const blockerPath = this.findRelaxedBlockerPath()
      if (
        blockerPath.found &&
        blockerPath.owners.size >= MIN_MULTI_OWNER_BLOCKER_COUNT
      ) {
        this.greedyConflictRepairPending = true
        this.attemptedGreedyConflictRepair = true
      }
    }
    super.onOutOfCandidates()
  }

  private tryApplyGreedyConflictRepair(): boolean {
    const originalGreedyFinalRouteIters = this.GREEDY_FINAL_ROUTE_ITERS
    this.GREEDY_FINAL_ROUTE_ITERS = 4
    const completedGreedyCandidate = this.tryGreedyFinalRouteAcceptance()
    this.GREEDY_FINAL_ROUTE_ITERS = originalGreedyFinalRouteIters
    if (!completedGreedyCandidate) return false

    const conflictingRouteIds = getRoutesWithIllegalGreedyCrossings(this)
    const {
      acceptedGreedyFinalRouteOnTimeout: _acceptedGreedyFinalRouteOnTimeout,
      greedyFinalRouteIter: _greedyFinalRouteIter,
      greedyFinalRouteRemainingRouteCount: _greedyFinalRouteRemainingRouteCount,
      greedyFinalRouteMaxIterations: _greedyFinalRouteMaxIterations,
      ...strictStats
    } = this.stats
    if (conflictingRouteIds.size === 0) {
      this.stats = {
        ...strictStats,
        greedyConflictRepairValidatedCandidate: true,
        greedyConflictRepairIteration: this.iterations,
      }
      return true
    }

    const greedyCandidateState: GreedyCandidateState = {
      regionSegments: this.state.regionSegments.map((segments) =>
        segments.map(
          ([routeId, fromPortId, toPortId]) =>
            [routeId, fromPortId, toPortId] as RouteSegment,
        ),
      ),
      regionCongestionCost: new Float64Array(this.state.regionCongestionCost),
      ripCount: this.state.ripCount,
    }
    this.seedStrictRepairFromGreedyCandidate(
      greedyCandidateState,
      conflictingRouteIds,
    )
    const privateSolver = this as unknown as {
      bestSolvedStateSnapshot?: unknown
      bestSolvedStateSummary?: unknown
    }
    privateSolver.bestSolvedStateSnapshot = undefined
    privateSolver.bestSolvedStateSummary = undefined
    this.GREEDY_FINAL_ROUTE_ITERS = 0
    this.solved = false
    this.failed = false
    this.error = null
    this.stats = {
      ...strictStats,
      greedyConflictRepairApplied: true,
      greedyConflictRepairIteration: this.iterations,
      greedyConflictRepairRouteCount: conflictingRouteIds.size,
    }
    return true
  }

  private seedStrictRepairFromGreedyCandidate(
    greedyCandidateState: GreedyCandidateState,
    conflictingRouteIds: ReadonlySet<number>,
  ): void {
    this.state.regionSegments = greedyCandidateState.regionSegments.map(
      (segments) =>
        segments.filter(([routeId]) => !conflictingRouteIds.has(routeId)),
    )
    this.state.regionCongestionCost = new Float64Array(
      greedyCandidateState.regionCongestionCost,
    )
    this.state.ripCount = greedyCandidateState.ripCount
    this.state.portAssignment.fill(-1)
    this.state.regionIntersectionCaches = Array.from(
      { length: this.topology.regionCount },
      () => createEmptyRegionIntersectionCache(),
    )
    for (
      let regionId = 0;
      regionId < this.state.regionSegments.length;
      regionId++
    ) {
      for (const [routeId, fromPortId, toPortId] of this.state.regionSegments[
        regionId
      ]!) {
        const routeNetId = this.problem.routeNet[routeId]!
        this.state.currentRouteNetId = routeNetId
        for (const portId of [fromPortId, toPortId]) {
          const assignedNetId = this.state.portAssignment[portId]!
          if (assignedNetId !== -1 && assignedNetId !== routeNetId) {
            throw new Error(
              `Greedy conflict repair retained incompatible port ${portId} for nets ${assignedNetId} and ${routeNetId}`,
            )
          }
          this.state.portAssignment[portId] = routeNetId
        }
        this.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
      }
    }
    const remainingIllegalRouteIds = getRoutesWithIllegalGreedyCrossings(this)
    if (remainingIllegalRouteIds.size > 0) {
      throw new Error(
        `Greedy conflict repair retained ${remainingIllegalRouteIds.size} routes with illegal same-layer crossings`,
      )
    }
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.state.unroutedRoutes = [...conflictingRouteIds]
    this.state.candidateQueue.clear()
    this.resetCandidateBestCosts()
    this.state.goalPortId = -1
  }
}
