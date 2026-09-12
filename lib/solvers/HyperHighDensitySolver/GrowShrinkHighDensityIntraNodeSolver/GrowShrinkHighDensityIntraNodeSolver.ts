import type { GraphicsObject } from "graphics-debug"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { BaseSolver } from "../../BaseSolver"
import { PortfolioSingleIntraNodeSolver } from "../PortfolioSingleIntraNodeSolver"
type PortfolioSingleIntraNodeSolverParams = ConstructorParameters<
  typeof PortfolioSingleIntraNodeSolver
>[0]

export const DEFAULT_MAX_GROWTH_ATTEMPTS = 3

export type GrowShrinkHighDensityIntraNodeSolverParams =
  PortfolioSingleIntraNodeSolverParams & {
    maxGrowthAttempts?: number
    maxInnerIterationsPerGrowthAttempt?: number
    fallbackToInvalidGeometryOnFailure?: boolean
    growShrinkSolutionValidator?: (
      routes: HighDensityIntraNodeRoute[],
    ) => boolean
  }

import * as bindings from "../../../../rust/capacity-autorouter-bindings/pkg/capacity_autorouter_bindings.js"
import { getGlobalInMemoryCache } from "../../../cache/setupGlobalCaches"
import { initializeAutorouterBindings } from "lib/bindings/initializeAutorouterBindings"
import { PortfolioCallbackScope } from "lib/bindings/high-density/PortfolioCallbackScope"

type SolverStateSnapshot = bindings.GrowthSnapshot

export class GrowShrinkHighDensityIntraNodeSolver extends BaseSolver {
  constructorParams: GrowShrinkHighDensityIntraNodeSolverParams
  nodeWithPortPoints: NodeWithPortPoints
  failedSolvers: PortfolioSingleIntraNodeSolver[] = []
  activeSubSolver: PortfolioSingleIntraNodeSolver | null = null
  winningSolver?: PortfolioSingleIntraNodeSolver
  scaleFactor = 1
  growthAttempts = 0
  maxGrowthAttempts: number
  private readonly binding: bindings.GrowShrinkHighDensityIntraNodeSolver
  private readonly scope: PortfolioCallbackScope
  private readonly scopeKey: number
  private readonly children = new Map<number, PortfolioSingleIntraNodeSolver>()
  private routes?: HighDensityIntraNodeRoute[]
  private synchronizing = false
  private observed = false
  private dirty = false
  private initialized = false

  constructor(params: GrowShrinkHighDensityIntraNodeSolverParams) {
    super()
    initializeAutorouterBindings()
    this.constructorParams = params
    this.nodeWithPortPoints = params.nodeWithPortPoints
    this.maxGrowthAttempts = params.maxGrowthAttempts ?? DEFAULT_MAX_GROWTH_ATTEMPTS
    this.scope = PortfolioCallbackScope.current ?? new PortfolioCallbackScope()
    const key = this.scope.registerGrowth(this)
    this.scopeKey = key
    const { growShrinkSolutionValidator: _, obstacles: _obstacles, connMap: _connMap, colorMap: _colorMap, ...input } = params
    const nativeInput = { ...input, hasCustomValidator: typeof params.growShrinkSolutionValidator === "function" }
    this.binding = this.scope.run(() => GrowShrinkHighDensityIntraNodeSolver.createBinding(key, nativeInput))
    this.initialized = true
    this.syncSolverState()
    this.installStateAccessors()
  }

  private static createBinding(key: number, input: bindings.HighDensityValue): bindings.GrowShrinkHighDensityIntraNodeSolver {
    const owner = (): GrowShrinkHighDensityIntraNodeSolver => {
      const scope = PortfolioCallbackScope.current
      if (!scope) throw new Error("Grow/shrink callback requires an execution scope")
      return scope.getGrowth(key)
    }
    return new bindings.GrowShrinkHighDensityIntraNodeSolver(
      input,
      (node: NodeWithPortPoints): number => {
        const solver = owner()
        const { growShrinkSolutionValidator: _, ...props } = solver.constructorParams
        const child = new PortfolioSingleIntraNodeSolver({ ...props, nodeWithPortPoints: node })
        const id = solver.scope.adopt(child)
        solver.children.set(id, child)
        return id
      },
      (routes: HighDensityIntraNodeRoute[], state: SolverStateSnapshot): { accepted: boolean; state: Record<string, unknown> } => {
        const solver = owner()
        solver.syncSolverState(state)
        const validator = solver.constructorParams.growShrinkSolutionValidator
        try {
          const accepted = validator ? validator(routes) : true
          const state = solver.statePatch()
          solver.dirty = false
          return { accepted, state }
        } finally {
          const cache = getGlobalInMemoryCache()
          bindings.HighDensitySolver.setCacheCounts(cache.cacheHits, cache.cacheMisses)
        }
      },
      (id: number): GraphicsObject => {
        const child = owner().child(id)
        const supervisor = child.getPortfolioAdapter()
        supervisor.finishSolverRun()
        supervisor.synchronize()
        return child.visualize()
      },
    )
  }

  private installStateAccessors(): void {
    for (const field of ["MAX_ITERATIONS", "iterations", "solved", "failed", "error", "progress", "stats",
      "nodeWithPortPoints", "scaleFactor", "growthAttempts", "maxGrowthAttempts", "activeSubSolver", "winningSolver", "failedSolvers"]) {
      let value: unknown = Reflect.get(this, field)
      Object.defineProperty(this, field, {
        configurable: true, enumerable: true,
        get: (): unknown => {
          if (!this.synchronizing && PortfolioCallbackScope.current !== this.scope) {
            this.observed = true
            this.syncSolverState()
          }
          return value
        },
        set: (incoming: unknown): void => {
          if (!this.synchronizing) {
            if (PortfolioCallbackScope.current !== this.scope) this.syncSolverState()
            this.dirty = true
          }
          value = incoming
        },
      })
    }
  }

  private childId(child: PortfolioSingleIntraNodeSolver): number {
    for (const [id, entry] of this.children) if (entry === child) return id
    const id = this.scope.adopt(child)
    this.children.set(id, child)
    return id
  }

  prepareSolverRun(): void {
    if (this.initialized && (this.dirty || this.observed || this.routes)) this.pushSolverState()
  }

  finishSolverRun(): void { this.syncObservedState() }

  syncObservedState(): void {
    if (this.initialized && !this.synchronizing && (this.observed || this.routes)) this.syncSolverState()
  }

  private child(id: number): PortfolioSingleIntraNodeSolver {
    const child = this.children.get(id)
    if (!child) throw new Error(`Unknown grow/shrink portfolio ${id}`)
    return child
  }

  override getSolverName(): string { return "GrowShrinkHighDensityIntraNodeSolver" }
  override getConstructorParams(): GrowShrinkHighDensityIntraNodeSolverParams { return this.constructorParams }

  get solvedRoutes(): HighDensityIntraNodeRoute[] {
    this.observed = true
    if (PortfolioCallbackScope.current !== this.scope) this.syncSolverState()
    if (!this.routes) {
      this.routes = this.winningSolver && this.scaleFactor === 1
        ? this.winningSolver.solvedRoutes
        : this.binding.routes()
    }
    return this.routes
  }

  set solvedRoutes(routes: HighDensityIntraNodeRoute[]) { if (PortfolioCallbackScope.current !== this.scope) this.syncSolverState(); this.routes = routes; this.dirty = true }

  private statePatch(): Record<string, unknown> {
    const { growShrinkSolutionValidator: _, obstacles: _obstacles, connMap: _connMap, colorMap: _colorMap, ...settings } = this.constructorParams
    return {
      MAX_ITERATIONS: this.MAX_ITERATIONS, iterations: this.iterations,
      solved: this.solved, failed: this.failed, error: this.error, progress: this.progress,
      constructorParams: { ...settings, hasCustomValidator: typeof this.constructorParams.growShrinkSolutionValidator === "function" }, nodeWithPortPoints: this.nodeWithPortPoints,
      scaleFactor: this.scaleFactor, growthAttempts: this.growthAttempts,
      maxGrowthAttempts: this.maxGrowthAttempts, stats: this.stats,
      ...(this.routes ? { solvedRoutes: this.routes } : {}),
    }
  }

  pushSolverState(): void {
    if (!this.initialized) return
    this.synchronizing = true
    try {
    const { growShrinkSolutionValidator: _, obstacles: _obstacles, connMap: _connMap, colorMap: _colorMap, ...settings } = this.constructorParams
    this.binding.restore({
      MAX_ITERATIONS: this.MAX_ITERATIONS, iterations: this.iterations,
      solved: this.solved, failed: this.failed, error: this.error, progress: this.progress,
      constructorParams: { ...settings, hasCustomValidator: typeof this.constructorParams.growShrinkSolutionValidator === "function" }, nodeWithPortPoints: this.nodeWithPortPoints,
      scaleFactor: this.scaleFactor, growthAttempts: this.growthAttempts,
      maxGrowthAttempts: this.maxGrowthAttempts, stats: this.stats,
      activeId: this.activeSubSolver ? this.childId(this.activeSubSolver) : null,
      winnerId: this.winningSolver ? this.childId(this.winningSolver) : null,
      failedIds: this.failedSolvers.map((child): number => this.childId(child)),
      ...(this.routes ? { solvedRoutes: this.routes } : {}),
    })
    this.dirty = false
    } finally { this.synchronizing = false }
  }

  syncSolverState(detachedSnapshot?: SolverStateSnapshot): void {
    if (!this.initialized || this.synchronizing || (this.dirty && !detachedSnapshot)) return
    this.synchronizing = true
    try {
    if (!detachedSnapshot) this.scope.sync()
    const state = detachedSnapshot ?? this.binding.snapshot()
    if (detachedSnapshot && !this.routes && state.solvedRoutes) this.routes = state.solvedRoutes
    const newlySolved = !this.solved && state.solved
    if (newlySolved) this.routes = undefined
    this.MAX_ITERATIONS = state.MAX_ITERATIONS
    this.iterations = state.iterations
    this.solved = state.solved
    this.failed = state.failed
    this.error = state.error
    this.progress = state.progress ?? Number.NaN
    this.scaleFactor = state.scaleFactor
    this.growthAttempts = state.growthAttempts
    this.maxGrowthAttempts = state.maxGrowthAttempts
    Object.assign(this.stats, state.stats)
    this.activeSubSolver = state.activeId === null ? null : this.child(state.activeId)
    this.winningSolver = state.winnerId === null ? undefined : this.child(state.winnerId)
    this.failedSolvers.splice(0, this.failedSolvers.length, ...state.failedIds.map((id): PortfolioSingleIntraNodeSolver => this.child(id)))
    for (const child of this.failedSolvers) child.getPortfolioAdapter().finishSolverRun()
    if (this.routes && !detachedSnapshot) {
      const routes = this.winningSolver && this.scaleFactor === 1
        ? this.winningSolver.solvedRoutes
        : this.binding.routes()
      if (this.routes !== routes) this.routes.splice(0, this.routes.length, ...routes)
      if (this.winningSolver && this.scaleFactor === 1) this.routes = routes
    }
    } finally { this.synchronizing = false }
  }

  override _step(): void {
    this.prepareSolverRun()
    try { this.scope.runGrowth(this.scopeKey, this, (): void => this.binding.stepInner(this.iterations, this.MAX_ITERATIONS)) }
    finally { this.syncSolverState() }
  }

  override solve(): void {
    const start = Date.now()
    this.prepareSolverRun()
    try { this.scope.runGrowth(this.scopeKey, this, (): void => this.binding.solve()) }
    finally { this.syncSolverState() }
    this.timeToSolve = Date.now() - start
  }

  computeProgress(): number {
    return Math.min(0.99, (this.growthAttempts + (this.activeSubSolver?.progress ?? 0)) / (this.maxGrowthAttempts + 1))
  }

  override visualize(): GraphicsObject {
    this.pushSolverState()
    return this.scope.runGrowth(this.scopeKey, this, (): GraphicsObject => this.binding.visualize())
  }

  shareForOrchestration(): number {
    this.pushSolverState()
    return this.binding.shareForOrchestration()
  }

  disposeUnobserved(): boolean {
    if (this.observed || this.dirty
      || typeof this.constructorParams.growShrinkSolutionValidator === "function") return false
    const supervisors = [...this.children.values()].map((child) => child.getPortfolioAdapter())
    if (supervisors.some((supervisor): boolean => !supervisor.canDisposeUnobserved())) return false
    for (const supervisor of supervisors) supervisor.disposeUnobserved()
    this.children.clear()
    this.dispose()
    return true
  }

  releaseOrchestrationScope(): void { this.scope.releaseGrowth(this.scopeKey) }

  dispose(): void { this.releaseOrchestrationScope(); this.binding.free() }
}
