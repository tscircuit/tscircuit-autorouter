import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import type { TinyHyperGraphTopology, TinyHyperGraphProblem, TinyHyperGraphSolverOptions } from "tiny-hypergraph/lib/core"
import { setNewIntersectionCounts } from "tiny-hypergraph/lib/countNewIntersections"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "../SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import { RouteProposalSolver, type RouteProposal, type RoutingInput, type RoutingSnapshot } from "./RouteProposalSolver"
import { SnapshotRouteBatchSolver } from "./SnapshotRouteBatchSolver"
import { packRoutingInput, type PackedRoutingInput } from "./packedRoutingInput"
import { packRoutingSnapshot } from "./packedRoutingSnapshot"

type Wave = { routeIds: number[]; snapshot: RoutingSnapshot }

/** Eight logical routes per snapshot, independent of the physical worker count. */
export class SnapshotBatchSolver extends SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments {
  readonly batchStats = { waves: 0, proposals: 0, accepted: 0, stale: 0, expansions: 0 }
  private readonly input: RoutingInput
  private localSearch?: RouteProposalSolver
  private packedInput?: PackedRoutingInput
  private asyncRunning = false

  constructor(topology: TinyHyperGraphTopology, problem: TinyHyperGraphProblem, options: TinyHyperGraphSolverOptions = {}) {
    super(topology, problem, {
      ...options,
      PARTIAL_RIP_ENABLED: false,
      OUTSIDE_IN_ROUTING: false,
      GREEDY_FINAL_ROUTE_ITERS: 0,
      MAX_ITERATIONS: Math.ceil(4 * (options.MAX_ITERATIONS ?? 2_000_000)),
    })
    this.input = {topology, problem, options}
  }

  private isCompatible(proposal: RouteProposal): boolean {
    const netId = this.problem.routeNet[proposal.routeId]!
    this.state.currentRouteNetId = netId
    for (const segment of proposal.segments) {
      for (const portId of [segment.fromPortId, segment.toPortId]) {
        const owner = this.state.portAssignment[portId]!
        if (owner !== -1 && owner !== netId) return false
        if (this.isPortReservedForDifferentNet(portId)) return false
      }
      if (this.isRegionReservedForDifferentNet(segment.regionId)) return false
      if (this.isKnownSingleLayerRegion(segment.regionId)) {
        const geometry = this.populateSegmentGeometryScratch(segment.regionId, segment.fromPortId, segment.toPortId)
        setNewIntersectionCounts(this.state.regionIntersectionCaches[segment.regionId]!, geometry)
        if (geometry.sameLayerIntersectionCount > 0) return false
      }
    }
    return true
  }

  private commit(proposal: RouteProposal): void {
    if (proposal.segments.length === 0) throw new Error("Empty route proposal")
    this.state.currentRouteId = proposal.routeId
    this.state.currentRouteNetId = this.problem.routeNet[proposal.routeId]!
    for (const {regionId, fromPortId, toPortId} of proposal.segments) {
      this.state.regionSegments[regionId]!.push([proposal.routeId, fromPortId, toPortId])
      this.state.portAssignment[fromPortId] = this.state.currentRouteNetId!
      this.state.portAssignment[toPortId] = this.state.currentRouteNetId!
      this.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
    }
    this.routeSuccessCountByRouteId[proposal.routeId]++
    this.state.candidateQueue.clear()
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.batchStats.accepted++
  }

  private prepareWave(): Wave | undefined {
    if (this.batchStats.expansions >= (this.input.options.MAX_ITERATIONS ?? 2_000_000) && this.bestSolvedStateSnapshot) {
      this.tryFinalAcceptance()
      return
    }
    if (this.state.unroutedRoutes.length === 0) {
      this.onAllRoutesRouted()
      return
    }
    if (this.batchStats.expansions >= this.MAX_ITERATIONS || this.batchStats.waves >= 10_000) {
      this.failed = true
      this.error = "Snapshot batch solver exhausted its deterministic budget"
      return
    }
    return {
      routeIds: this.state.unroutedRoutes.slice(0, 8),
      snapshot: {
        portAssignment: this.state.portAssignment,
        populatedCaches: this.state.regionIntersectionCaches.flatMap((cache, regionId) =>
          cache.existingSegmentCount > 0 ? [[regionId, cache] as [number, typeof cache]] : []),
        regionCongestionCost: this.state.regionCongestionCost,
      },
    }
  }

  private reconcile(wave: Wave, proposals: RouteProposal[]): void {
    if (proposals.length !== wave.routeIds.length || proposals.some((proposal, index) => proposal.routeId !== wave.routeIds[index])) {
      throw new Error("Snapshot proposal order does not match the logical wave")
    }
    this.batchStats.waves++
    this.batchStats.proposals += proposals.length
    this.batchStats.expansions += proposals.reduce((sum, proposal) => sum + proposal.iterations, 0)
    this.state.unroutedRoutes.splice(0, wave.routeIds.length)
    const retry: number[] = []
    let failedRouteId: number | undefined
    for (const proposal of proposals) {
      if (proposal.found && !this.isCompatible(proposal)) {
        this.batchStats.stale++
        retry.push(proposal.routeId)
        this.state.currentRouteId = undefined
        this.state.currentRouteNetId = undefined
        continue
      }
      if (proposal.found) this.commit(proposal)
      else {
        failedRouteId ??= proposal.routeId
        retry.push(proposal.routeId)
      }
    }
    this.state.unroutedRoutes.unshift(...retry)
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    if (failedRouteId !== undefined) {
      this.state.unroutedRoutes = this.state.unroutedRoutes.filter(routeId => routeId !== failedRouteId)
      this.state.currentRouteId = failedRouteId
      this.state.currentRouteNetId = this.problem.routeNet[failedRouteId]!
      this.state.goalPortId = this.problem.routeEndPort[failedRouteId]!
      this.onOutOfCandidates()
    }
    this.stats = {...this.stats, snapshotBatch: {...this.batchStats}}
  }

  override _step(): void {
    const wave = this.prepareWave()
    if (!wave) return
    this.localSearch ??= new RouteProposalSolver(this.input)
    this.localSearch.setSnapshot(wave.snapshot)
    this.reconcile(wave, wave.routeIds.map(routeId => this.localSearch!.search(routeId)))
  }

  async solveAsync(runtime?: SolverRuntimeExecutor, stopAtIteration = Infinity): Promise<void> {
    if (this.asyncRunning) throw new Error("Snapshot solveAsync is already running")
    this.asyncRunning = true
    try {
      this.setup()
      while (!this.solved && !this.failed && this.iterations < stopAtIteration) {
        if (!runtime) {
          this.step()
          continue
        }
        this.iterations++
        const wave = this.prepareWave()
        if (!wave) continue
        this.packedInput ??= packRoutingInput(this.input)
        const snapshot = packRoutingSnapshot(wave.snapshot, this.batchStats.waves)
        const jobs = []
        for (const routeId of wave.routeIds) {
          jobs.push(runtime.executeAsync(SnapshotRouteBatchSolver, {
            graph: this.packedInput,
            snapshot,
            routeIds: [routeId],
          }))
        }
        // Promise order, never worker completion order, determines acceptance.
        this.reconcile(wave, (await Promise.all(jobs)).flat())
      }
    } catch (error) {
      this.failed = true
      this.error = `Snapshot worker execution failed: ${error}`
      throw error
    } finally {
      this.asyncRunning = false
    }
  }
}
