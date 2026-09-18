import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import type { CapacityMeshNode } from "lib/types"
import { calculateNodeProbabilityOfFailure } from "lib/solvers/UnravelSolver/calculateCrossingProbabilityOfFailure"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"
import { visualizeCongestionRerouting } from "./visualizeCongestionRerouting"
import { RegionAvoidingRouteSolver } from "./RegionAvoidingRouteSolver"

type CongestionScore = {
  regionPf: Map<number, number>
  maxPf: number
  squaredPfSum: number
}
export type ReroutingPhase =
  | "ready"
  | "selected"
  | "blocked"
  | "searching"
  | "accepted"
  | "rejected"
  | "exhausted"
  | "complete"
type RouteAttempt = { regionId: number; routeId: number }
export type CongestionReroutingInput = {
  solver: TinyHyperGraphSolver
  nodesByRegionId: ReadonlyMap<number, CapacityMeshNode>
  /** Original graph permissions, before section optimization restricts the search. */
  portSectionMask?: Int8Array
  preservedRouteIds?: ReadonlySet<number>
  maxAttempts?: number
  pfThreshold?: number
  maxIterationsPerAttempt?: number
}

/** Bounded local search over complete assignments; PF is a heuristic, not DRC. */
export class CongestionReroutingSolver extends BaseSolver {
  private readonly portSectionMask: Int8Array
  private incumbent: TinyHyperGraphSolver
  private score: CongestionScore
  private candidate: RegionAvoidingRouteSolver | null = null
  private pending: RouteAttempt[] = []
  private readonly maxAttempts: number
  private readonly pfThreshold: number
  private readonly maxIterationsPerAttempt: number
  phase: ReroutingPhase = "ready"
  selectedAttempt: RouteAttempt | null = null
  private previousSolver: TinyHyperGraphSolver | null = null
  private previousRegionPf = 0
  attempts = 0
  accepted = 0
  rejected = 0
  exhausted = 0
  readonly initialMaxPf: number
  readonly initialSquaredPfSum: number

  constructor(private readonly input: CongestionReroutingInput) {
    super()
    this.maxAttempts = input.maxAttempts ?? 16
    this.pfThreshold = input.pfThreshold ?? 0.5
    this.maxIterationsPerAttempt = input.maxIterationsPerAttempt ?? 10_000
    if (!input.solver.solved || input.solver.failed) {
      throw new Error(
        "CongestionReroutingSolver requires a complete pathing solution",
      )
    }
    if (
      !Number.isInteger(this.maxAttempts) ||
      this.maxAttempts < 0 ||
      !Number.isFinite(this.pfThreshold) ||
      this.pfThreshold < 0 ||
      !Number.isInteger(this.maxIterationsPerAttempt) ||
      this.maxIterationsPerAttempt < 1
    ) {
      throw new Error(
        "CongestionReroutingSolver: invalid search budget or PF threshold",
      )
    }
    this.portSectionMask = new Int8Array(
      input.portSectionMask ?? input.solver.problem.portSectionMask,
    )
    if (
      this.portSectionMask.length !== input.solver.topology.portCount ||
      this.portSectionMask.some((value) => value !== 0 && value !== 1)
    ) {
      throw new Error(
        "CongestionReroutingSolver: invalid original graph permissions",
      )
    }
    this.incumbent = input.solver
    this.score = this.measure(this.incumbent)
    this.initialMaxPf = this.score.maxPf
    this.initialSquaredPfSum = this.score.squaredPfSum
    this.MAX_ITERATIONS =
      this.maxAttempts * (this.maxIterationsPerAttempt + 4) + 2
    this.selectAttempts()
    this.publishStats()
  }

  private measure(solver: TinyHyperGraphSolver): CongestionScore {
    const regionPf = new Map<number, number>()
    let maxPf = 0
    let squaredPfSum = 0
    for (const [regionId, node] of this.input.nodesByRegionId) {
      const segments = solver.state.regionSegments[regionId]
      if (!segments)
        throw new Error(`CongestionReroutingSolver: missing region ${regionId}`)
      const portPoints = segments.flatMap(([routeId, fromPortId, toPortId]) =>
        [fromPortId, toPortId].map((portId) => ({
          x: solver.topology.portX[portId],
          y: solver.topology.portY[portId],
          z: solver.topology.portZ[portId],
          connectionName: String(routeId),
        })),
      )
      const crossings = getIntraNodeCrossingsUsingCircle({
        ...node,
        portPoints,
      })
      const pf = calculateNodeProbabilityOfFailure(
        node,
        crossings.numSameLayerCrossings,
        crossings.numEntryExitLayerChanges,
        crossings.numTransitionPairCrossings,
      )
      if (!Number.isFinite(pf) || pf < 0)
        throw new Error(`Invalid PF in region ${regionId}`)
      regionPf.set(regionId, pf)
      maxPf = Math.max(maxPf, pf)
      squaredPfSum += pf * pf
    }
    return { regionPf, maxPf, squaredPfSum }
  }

  private selectAttempts(): void {
    this.pending = []
    const { topology, problem, state } = this.incumbent
    const hotRegions = [...this.score.regionPf]
      .filter(([, pf]) => pf > this.pfThreshold)
      .sort(([a, pfA], [b, pfB]) => pfB - pfA || a - b)
    for (const [regionId] of hotRegions) {
      const routeIds = [
        ...new Set(state.regionSegments[regionId].map(([routeId]) => routeId)),
      ].sort((a, b) => a - b)
      for (const routeId of routeIds) {
        if (this.input.preservedRouteIds?.has(routeId)) continue
        const startRegions =
          topology.incidentPortRegion[problem.routeStartPort[routeId]]
        const endRegions =
          topology.incidentPortRegion[problem.routeEndPort[routeId]]
        if (startRegions.includes(regionId) || endRegions.includes(regionId))
          continue
        this.pending.push({ regionId, routeId })
      }
    }
  }

  override _step(): void {
    if (this.candidate) {
      this.phase = "searching"
      this.candidate.step()
      if (this.candidate.failed && !this.candidate.searchExhausted) {
        throw new Error(
          `Congestion rerouting invariant failure: ${this.candidate.error}`,
        )
      }
      if (this.candidate.solved) {
        const score = this.measure(this.candidate)
        if (
          score.maxPf <= this.score.maxPf + 1e-9 &&
          score.squaredPfSum < this.score.squaredPfSum - 1e-9
        ) {
          this.incumbent = this.candidate
          this.score = score
          this.phase = "accepted"
          this.accepted++
          this.selectAttempts()
        } else {
          this.phase = "rejected"
          this.rejected++
        }
      } else if (
        this.candidate.searchExhausted ||
        this.candidate.iterations >= this.maxIterationsPerAttempt
      ) {
        this.phase = "exhausted"
        this.exhausted++
      } else {
        return
      }
      this.candidate = null
      this.activeSubSolver = null
      this.publishStats()
      return
    }
    if (this.attempts >= this.maxAttempts || this.pending.length === 0) {
      // Completion means congestion search ended, not that physical routing passed DRC.
      this.phase = "complete"
      this.solved = true
      this.progress = 1
      this.publishStats()
      return
    }
    if (this.phase !== "selected") {
      this.selectedAttempt = this.pending[0]
      this.previousSolver = this.incumbent
      this.previousRegionPf = this.score.regionPf.get(
        this.selectedAttempt.regionId,
      )!
      this.phase = "selected"
      this.publishStats()
      return
    }
    const { regionId, routeId } = this.pending.shift()!
    this.candidate = new RegionAvoidingRouteSolver(
      this.incumbent,
      routeId,
      regionId,
      this.maxIterationsPerAttempt,
      this.portSectionMask,
    )
    this.phase = "blocked"
    this.activeSubSolver = this.candidate
    this.attempts++
    this.publishStats()
  }

  override visualize(options: { focus?: boolean } = {}): GraphicsObject {
    return visualizeCongestionRerouting({
      solver: this.candidate ?? this.incumbent,
      previousSolver: this.previousSolver,
      nodesByRegionId: this.input.nodesByRegionId,
      attempt: this.selectedAttempt,
      phase: this.phase,
      previousRegionPf: this.previousRegionPf,
      regionPf: this.selectedAttempt
        ? this.score.regionPf.get(this.selectedAttempt.regionId)!
        : 0,
      maxPf: this.score.maxPf,
      focus: options.focus ?? false,
    })
  }

  getCurrentPhase(): string {
    return `congestion:${this.attempts}:${this.phase}`
  }

  override getConstructorParams(): [CongestionReroutingInput] {
    const input: CongestionReroutingInput = {
      ...this.input,
    }
    return [input]
  }

  private publishStats(): void {
    this.stats = {
      phase: this.phase,
      attempts: this.attempts,
      accepted: this.accepted,
      rejected: this.rejected,
      exhausted: this.exhausted,
      initialMaxPf: this.initialMaxPf,
      maxPf: this.score.maxPf,
      initialSquaredPfSum: this.initialSquaredPfSum,
      squaredPfSum: this.score.squaredPfSum,
      stopReason: this.solved
        ? this.attempts >= this.maxAttempts
          ? "budget"
          : "no-improving-move"
        : null,
    }
  }

  override getOutput(): TinyHyperGraphSolver {
    if (!this.solved || this.failed) {
      throw new Error(
        "CongestionReroutingSolver: output requested before successful completion",
      )
    }
    const output = this.incumbent
    return output
  }
}
