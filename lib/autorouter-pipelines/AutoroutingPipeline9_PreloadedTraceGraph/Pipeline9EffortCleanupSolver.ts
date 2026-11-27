import {
  TraceSimplificationSolver,
  UselessViaRemovalSolver,
} from "@tscircuit/trace-simplification-solver"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

type CleanupCost = { vias: number; points: number }
type ViaProposal = {
  replacements: Map<number, HighDensityRoute>
  viasSaved: number
}
type CleanupParams = {
  config: ConstructorParameters<typeof TraceSimplificationSolver>[0]
  effort: number
  viaRemovalPasses?: 1 | 2
  viaOptimization?: { protectedConnectionNames: ReadonlySet<string> }
  getCost: (routes: HighDensityRoute[]) => CleanupCost
  isValid: (routes: HighDensityRoute[]) => boolean
  refineTraceWidths?: (routes: HighDensityRoute[]) => HighDensityRoute[]
}

/** Post-repair cleanup commits only valid improvements, including at default effort. */
export class Pipeline9EffortCleanupSolver extends BaseSolver {
  bestRoutes: HighDensityRoute[]
  bestCost: CleanupCost
  completedPasses = 0
  readonly cleanupPasses: number
  simplifier?: TraceSimplificationSolver
  viaRemovalSolver?: UselessViaRemovalSolver
  private viaOptimizationRouteIndices?: number[]
  private viaProposals?: ViaProposal[]
  readonly params: CleanupParams

  constructor(params: CleanupParams) {
    super()
    this.params = params
    this.bestRoutes = structuredClone([...params.config.hdRoutes])
    this.bestCost = params.getCost(this.bestRoutes)
    this.cleanupPasses =
      params.effort <= 1
        ? (params.viaRemovalPasses ?? 1)
        : Math.ceil(2 * params.effort)
    this.MAX_ITERATIONS =
      100e6 *
      (Math.max(1, this.cleanupPasses) +
        Number(params.viaOptimization !== undefined))
    if (params.effort <= 1) {
      // Path sampling already ran before repair. Only revisit removable vias
      // at default effort; repeated path and crossing searches are expensive.
      this.viaRemovalSolver = this.createViaRemovalSolver()
      return
    }
    this.simplifier = new TraceSimplificationSolver({
      ...params.config,
      enableRoutedTraceDetours: true,
      hdRoutes: structuredClone(this.bestRoutes),
    })
    // Pre-repair path simplification has already reduced the route points.
    // Enable geometry shortcuts from the first post-repair pass.
    this.simplifier.simplificationPipelineLoops = 2
    this.simplifier.MAX_SIMPLIFICATION_PIPELINE_LOOPS = 2 + this.cleanupPasses
    this.simplifier.MAX_ITERATIONS = this.MAX_ITERATIONS
  }

  private createViaRemovalSolver(
    hdRoutes = this.bestRoutes,
    otherHdRoutes = this.params.config.otherHdRoutes,
  ): UselessViaRemovalSolver {
    const config = this.params.config
    const solver = new UselessViaRemovalSolver({
      unsimplifiedHdRoutes: structuredClone(hdRoutes),
      otherHdRoutes,
      obstacles: [...config.obstacles],
      colorMap: config.colorMap,
      layerCount: config.layerCount,
      connMap: config.connMap,
      outline: config.outline ? [...config.outline] : undefined,
      geometryShortcutTraceMargin: 0.1,
      geometryShortcutObstacleMargin: config.minTraceToPadEdgeClearance ?? 0.15,
      enableGeometryShortcuts: true,
      enableRoutedTraceDetours: true,
      enableObstacleDetourShortcuts: config.enableCrossingViaReduction,
      preserveRouteEndpoints: config.preserveRouteEndpoints,
      terminalLayerIndicesByPcbPortId: config.terminalLayerIndicesByPcbPortId,
    })
    solver.MAX_ITERATIONS = this.MAX_ITERATIONS
    return solver
  }

  override _step(): void {
    if (this.viaProposals) {
      this.evaluateNextViaProposal()
      return
    }
    if (this.viaRemovalSolver) {
      const remover = this.viaRemovalSolver
      remover.step()
      if (remover.failed) {
        this.failed = true
        this.error = remover.error
        return
      }
      if (!remover.solved) return
      const candidate = remover.getOptimizedHdRoutes()
      if (!candidate) throw new Error("Via removal has no output")
      if (this.viaOptimizationRouteIndices) {
        this.viaProposals = this.getViaProposals(
          this.viaOptimizationRouteIndices,
          candidate,
        )
        return
      }
      const cost = this.params.getCost(candidate)
      // Validate once, after the complete via pass, rather than after every
      // phase of multiple full simplification loops.
      const improves =
        cost.vias < this.bestCost.vias && this.params.isValid(candidate)
      if (improves) {
        this.bestRoutes = structuredClone(candidate)
        this.bestCost = cost
      }
      this.completedPasses++
      // Earlier removals can unblock a different route on the next sweep.
      // Reserve that extra work for repairs that introduced new vias, and
      // stop as soon as a complete sweep produces no valid improvement.
      if (improves && this.completedPasses < this.cleanupPasses) {
        this.viaRemovalSolver = this.createViaRemovalSolver()
        return
      }
      this.finish()
      return
    }
    const simplifier = this.simplifier
    if (!simplifier) throw new Error("Cleanup has no active simplifier")
    const previousPhase = simplifier.currentPhase
    const previousLoops = simplifier.simplificationPipelineLoops
    simplifier.step()
    if (simplifier.failed) {
      this.failed = true
      this.error = simplifier.error
      return
    }
    const completedPasses = simplifier.simplificationPipelineLoops - 2
    this.completedPasses = completedPasses
    // Keep legal via reductions before a later path pass can invalidate them.
    if (
      simplifier.currentPhase !== previousPhase ||
      simplifier.simplificationPipelineLoops !== previousLoops
    ) {
      const candidate = simplifier.simplifiedHdRoutes
      const cost = this.params.getCost(candidate)
      const improves =
        cost.vias < this.bestCost.vias ||
        (cost.vias === this.bestCost.vias && cost.points < this.bestCost.points)
      if (improves && this.params.isValid(candidate)) {
        this.bestRoutes = structuredClone(candidate)
        this.bestCost = cost
      }
    }
    if (simplifier.solved) this.finish()
  }

  private getViaProposals(
    indices: number[],
    candidate: HighDensityRoute[],
  ): ViaProposal[] {
    if (candidate.length !== indices.length)
      throw new Error("Via optimization did not return all routes")
    const groups = new Map<string, Map<number, HighDensityRoute>>()
    for (const [offset, index] of indices.entries()) {
      const original = this.bestRoutes[index]!
      const { route, vias, connectionName } = candidate[offset]!
      if (connectionName !== original.connectionName)
        throw new Error("Via optimization reordered its routes")
      const rootName = original.rootConnectionName ?? connectionName
      const replacements =
        groups.get(rootName) ?? new Map<number, HighDensityRoute>()
      replacements.set(index, { ...original, route, vias })
      groups.set(rootName, replacements)
    }
    const proposals: ViaProposal[] = []
    for (const replacements of groups.values()) {
      const original = [...replacements.keys()].map(
        (index) => this.bestRoutes[index]!,
      )
      const viasSaved =
        this.params.getCost(original).vias -
        this.params.getCost([...replacements.values()]).vias
      if (viasSaved > 0) proposals.push({ replacements, viasSaved })
    }
    return proposals.sort((a, b) => a.viasSaved - b.viasSaved)
  }

  private evaluateNextViaProposal(): void {
    const proposal = this.viaProposals!.pop()
    if (!proposal) {
      this.finish()
      return
    }
    const candidate = this.bestRoutes.map(
      (route, index) => proposal.replacements.get(index) ?? route,
    )
    const cost = this.params.getCost(candidate)
    if (cost.vias < this.bestCost.vias && this.params.isValid(candidate)) {
      this.bestRoutes = candidate
      this.bestCost = cost
    }
  }

  private finish(): void {
    const viaOptimization = this.params.viaOptimization
    if (
      viaOptimization &&
      !this.viaOptimizationRouteIndices &&
      this.bestCost.vias
    ) {
      // Grade one connection at a time against the accepted board. An invalid
      // proposal for one connection cannot discard legal savings elsewhere.
      const protectedNames = new Set(viaOptimization.protectedConnectionNames)
      for (const route of this.bestRoutes) {
        if (
          protectedNames.has(route.connectionName) &&
          route.rootConnectionName
        ) {
          protectedNames.add(route.rootConnectionName)
        }
      }
      const indices: number[] = []
      const routes: HighDensityRoute[] = []
      const fixedRoutes = [...(this.params.config.otherHdRoutes ?? [])]
      for (const [index, route] of this.bestRoutes.entries()) {
        if (
          protectedNames.has(route.rootConnectionName ?? route.connectionName)
        ) {
          fixedRoutes.push(route)
        } else {
          indices.push(index)
          routes.push(route)
        }
      }
      if (indices.length) {
        this.viaOptimizationRouteIndices = indices
        this.viaRemovalSolver = this.createViaRemovalSolver(routes, fixedRoutes)
        return
      }
    }
    if (this.params.refineTraceWidths) {
      const refined = this.params.refineTraceWidths(this.bestRoutes)
      if (refined !== this.bestRoutes) {
        this.bestRoutes = refined
        this.bestCost = this.params.getCost(refined)
      }
    }
    this.solved = true
  }

  getOutput(): HighDensityRoute[] {
    if (!this.solved) throw new Error("Cleanup is not complete")
    return this.bestRoutes
  }
}
