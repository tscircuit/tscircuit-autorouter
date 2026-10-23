import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  createEmptyRegionIntersectionCache,
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/core"
import { allocateCompatibleTinyRouteCandidates } from "./allocateCompatibleTinyRouteCandidates"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "./SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"

type CompleteCandidate = {
  key: string
  regionSegments: TinyHyperGraphSolver["state"]["regionSegments"]
  portAssignment: Int32Array
}

/** Retains native rerip outcomes; it never schedules another route search. */
export class SelectiveReripTinyHyperGraphSolverWithCandidatePool extends SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments {
  private readonly completeCandidates: CompleteCandidate[] = []
  private originalPreloadedCopper: boolean | undefined
  private allocationComplete = false
  private completeRoundCount = 0
  private distinctCaptureCount = 0

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions,
  ) {
    super(topology, problem, options)
  }

  configureCandidatePool(hasOriginalPreloadedCopper: boolean): void {
    if (this.iterations !== 0 || this.originalPreloadedCopper !== undefined) {
      throw new Error("Native candidate provenance must be configured exactly once before routing")
    }
    this.originalPreloadedCopper = hasOriginalPreloadedCopper
    this.stats = {
      ...this.stats,
      jointCandidateAvailableBoards: 0,
      jointCandidateEligibleBoards: 0,
      jointCandidateTrials: 0,
      jointCandidateAcceptedExchanges: 0,
      jointCandidateHybridNetCount: 0,
      jointCandidateCompleteRounds: 0,
      jointCandidateDistinctCaptures: 0,
      jointCandidateRetainedCandidates: 0,
      jointCandidateFinalizationCount: 0,
    }
  }

  private getCandidateKey(): string {
    return this.state.regionSegments.map((segments, region) =>
      segments.map(([route, from, to]) =>
        `${region}:${route}:${Math.min(from, to)}:${Math.max(from, to)}`,
      ).sort().join("|"),
    ).join(";")
  }

  override onAllRoutesRouted(): void {
    if (this.originalPreloadedCopper === undefined) {
      throw new Error("Native candidate pool is missing original copper provenance")
    }
    this.completeRoundCount++
    // The superclass may immediately clear these segments for another rerip.
    // Physical preloads remain outside this experiment's mixing contract.
    if (!this.originalPreloadedCopper) {
      const key = this.getCandidateKey()
      if (!this.completeCandidates.some((candidate) => candidate.key === key)) {
        if (this.completeCandidates.length === 2) this.completeCandidates.shift()
        this.completeCandidates.push({
          key,
          regionSegments: structuredClone(this.state.regionSegments),
          portAssignment: new Int32Array(this.state.portAssignment),
        })
        this.distinctCaptureCount++
      }
    }
    super.onAllRoutesRouted()
    this.stats = {
      ...this.stats,
      jointCandidateCompleteRounds: this.completeRoundCount,
      jointCandidateDistinctCaptures: this.distinctCaptureCount,
      jointCandidateRetainedCandidates: this.completeCandidates.length,
    }
  }

  private replayCandidate(candidate: CompleteCandidate): TinyHyperGraphSolver {
    const replay = new TinyHyperGraphSolver(this.topology, this.problem, {
      minViaPadDiameter: this.minViaPadDiameter,
      TRACE_DENSITY_COST_FACTOR: this.TRACE_DENSITY_COST_FACTOR,
    })
    // Rebuild caches directly. Rerip hooks can restore an unrelated initial
    // assignment and must not participate in replaying a complete candidate.
    replay.state.portAssignment = new Int32Array(candidate.portAssignment)
    replay.state.regionSegments = structuredClone(candidate.regionSegments)
    replay.state.regionIntersectionCaches = Array.from(
      { length: this.topology.regionCount },
      () => createEmptyRegionIntersectionCache(),
    )
    for (let region = 0; region < replay.state.regionSegments.length; region++) {
      for (const [route, from, to] of replay.state.regionSegments[region]!) {
        replay.state.currentRouteNetId = this.problem.routeNet[route]!
        replay.appendSegmentToRegionCache(region, from, to)
      }
    }
    replay.state.currentRouteId = undefined
    replay.state.currentRouteNetId = undefined
    replay.state.unroutedRoutes = []
    replay.state.candidateQueue.clear()
    replay.state.goalPortId = -1
    replay.solved = true
    return replay
  }

  override getOutput(): SerializedHyperGraph {
    if (!this.solved || this.failed) {
      return super.getOutput()
    }
    if (this.originalPreloadedCopper === undefined) {
      throw new Error("Native candidate pool is missing original copper provenance")
    }
    if (!this.allocationComplete) {
      const finalKey = this.getCandidateKey()
      const alternative = [...this.completeCandidates].reverse().find(
        (candidate) => candidate.key !== finalKey,
      )
      if (alternative) {
        try {
          const allocationStats = allocateCompatibleTinyRouteCandidates(
            this,
            this.replayCandidate(alternative),
            { hasPreloadedCopper: this.originalPreloadedCopper },
          )
          this.stats = { ...this.stats, ...allocationStats }
        } catch (error) {
          this.failed = true
          this.solved = false
          this.error = `Native joint candidate allocation failed: ${error}`
          throw error
        }
      }
      this.stats = {
        ...this.stats,
        jointCandidatePreloadedUnavailable: Math.max(
          Number(this.originalPreloadedCopper),
          Number(this.stats.jointCandidatePreloadedUnavailable ?? 0),
        ),
        jointCandidateFinalizationCount: 1,
      }
      this.completeCandidates.length = 0
      this.allocationComplete = true
    }
    return super.getOutput()
  }
}
