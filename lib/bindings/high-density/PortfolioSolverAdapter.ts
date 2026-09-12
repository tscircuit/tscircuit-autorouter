import { HighDensitySolverA13 } from "@tscircuit/high-density-a13"
import { IntraNodeRouteSolver } from "../../solvers/HighDensitySolver/IntraNodeSolver"
import { initializeAutorouterBindings } from "lib/bindings/initializeAutorouterBindings"
import { PortfolioCallbackScope } from "lib/bindings/high-density/PortfolioCallbackScope"
import { getGlobalInMemoryCache } from "../../cache/setupGlobalCaches"
import * as bindings from "../../../rust/capacity-autorouter-bindings/pkg/capacity_autorouter_bindings.js"
import type { PortfolioSingleIntraNodeSolver } from "../../solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { CachedIntraNodeRouteSolver } from "../../solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { HighDensitySolverAdapter } from "../../../rust/capacity-autorouter-bindings/ts/index"
import { SpecializedIntraNodeSolverAdapter } from "lib/bindings/high-density/SpecializedIntraNodeSolverAdapter"
import { withSpecializedRouterContext } from "lib/bindings/high-density/specializedRouterContext"

type Candidate = ReturnType<PortfolioSingleIntraNodeSolver["generateSolver"]>
type SupervisedCandidate = NonNullable<
  PortfolioSingleIntraNodeSolver["supervisedSolvers"]
>[number]
type CandidateState = bindings.CandidateStateSnapshot
type SolverStateSnapshot = bindings.PortfolioSnapshot

type CallbackScope = {
  current: PortfolioSolverAdapter | undefined
  orchestrationKey?: number
}

function callbackOwner(scope: CallbackScope): PortfolioSolverAdapter {
  const supervisor =
    scope.current ??
    (scope.orchestrationKey === undefined
      ? undefined
      : PortfolioCallbackScope.current?.get(scope.orchestrationKey))
  if (!supervisor)
    throw new Error("Native portfolio callback outside an active call")
  return supervisor
}

function refreshCacheCounts(): void {
  const cache = getGlobalInMemoryCache()
  bindings.HighDensitySolver.setCacheCounts(cache.cacheHits, cache.cacheMisses)
}

function getState(solver: Candidate): CandidateState {
  const state: CandidateState = {
    iterations: solver.iterations,
    maxIterations: solver.MAX_ITERATIONS,
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    progress: solver.progress,
    solvedSegmentCount:
      solver instanceof HighDensitySolverAdapter
        ? solver.getSolvedSegmentCount()
        : null,
  }
  if (solver instanceof HighDensitySolverA13) {
    state.routingIterations = solver.routingIterations
    const connectionCount = solver.connections.length
    if (solver.solved) {
      state.negotiatedProgress = 1
    } else if (connectionCount === 0) {
      state.negotiatedProgress = 0
    } else {
      const routedFraction = solver.routedCount / connectionCount
      const conflictFreeFraction = Math.max(
        0,
        (solver.routedCount - solver.conflictCount) / connectionCount,
      )
      state.negotiatedProgress = Math.min(
        0.99,
        (routedFraction + conflictFreeFraction) / 2,
      )
    }
  }
  return state
}

function syncState(solver: Candidate, state: CandidateState): void {
  solver.iterations = state.iterations
  solver.MAX_ITERATIONS = state.maxIterations
  solver.solved = state.solved
  solver.failed = state.failed
  solver.error = state.error
  solver.progress = state.progress === null ? Number.NaN : state.progress
  if (solver instanceof HighDensitySolverAdapter) {
    solver._setupDone = true
    if (state.solvedSegmentCount !== null)
      solver.syncPortfolioSegmentCount(state.solvedSegmentCount)
  }
}

export class PortfolioSolverAdapter {
  // Rust retains these callbacks. Limit their owner reference to the native call:
  // WeakRef would keep each dereferenced portfolio alive for the entire solve job.
  private readonly callbackScope: CallbackScope = { current: undefined }
  private binding: bindings.PortfolioSingleIntraNodeSolver | undefined
  private executionScope?: PortfolioCallbackScope
  private observed = false
  private ownerDirty = false
  private shared = false
  private dirty = false
  private synchronizing = false
  private stepping = false
  private bestId: number | undefined
  private greedyMultiplier = 5
  private minSubsteps = 100
  private readonly candidates: Candidate[] = []
  private readonly supervisedById = new Map<number, SupervisedCandidate>()

  constructor(private readonly owner: PortfolioSingleIntraNodeSolver) {
    initializeAutorouterBindings()
    for (const key of [
      "supervisedSolvers",
      "activeSubSolver",
      "winningSolver",
      "stats",
      "adaptiveSearchExpanded",
      "negotiatedSearchStarted",
    ] as const) {
      let value: unknown = owner[key]
      if (key === "stats") {
        value = new Proxy(value as Record<string, unknown>, {
          get: (target, property, receiver): unknown => {
            this.synchronize()
            return Reflect.get(target, property, receiver)
          },
          ownKeys: (target): ArrayLike<string | symbol> => {
            this.synchronize()
            return Reflect.ownKeys(target)
          },
        })
      }
      Object.defineProperty(owner, key, {
        configurable: true,
        enumerable: true,
        get: (): unknown => {
          if (this.shared && !this.stepping && !this.synchronizing)
            this.observed = true
          this.synchronize()
          return value
        },
        set: (next: unknown): void => {
          value = next
        },
      })
    }
    this.binding = PortfolioSolverAdapter.createBinding(
      this.callbackScope,
      owner.nodeWithPortPoints,
      owner.effort,
      owner.enableNegotiatedSearch,
    )
  }

  private static createBinding(
    scope: CallbackScope,
    node: bindings.HighDensityNode,
    effort: number,
    enableNegotiatedSearch: boolean,
  ): bindings.PortfolioSingleIntraNodeSolver {
    return new bindings.PortfolioSingleIntraNodeSolver(
      node,
      effort,
      (hyperParameters: Record<string, unknown>): Record<string, unknown> => {
        const supervisor = callbackOwner(scope)
        const solver = withSpecializedRouterContext(() =>
          supervisor.owner.generateSolver(hyperParameters),
        )
        const id = supervisor.candidates.push(solver) - 1
        const kind =
          solver instanceof CachedIntraNodeRouteSolver
            ? "general"
            : solver instanceof HighDensitySolverAdapter
              ? solver.variant
              : solver instanceof SpecializedIntraNodeSolverAdapter
                ? "specialized"
                : "external"
        const handle =
          solver instanceof HighDensitySolverAdapter ||
          solver instanceof SpecializedIntraNodeSolverAdapter
            ? solver.shareForPortfolio()
            : undefined
        if (kind !== "external") supervisor.installCandidateGetters(solver, id)
        return {
          id,
          kind,
          handle,
          state: getState(solver),
          totalConnections:
            solver instanceof CachedIntraNodeRouteSolver
              ? solver.totalConnections
              : undefined,
          hasCache:
            solver instanceof CachedIntraNodeRouteSolver &&
            solver.cacheProvider !== null,
        }
      },
      (
        id: number,
        action: "setup" | "step" | "attach-general",
        count: number,
      ): CandidateState | { handle: number } => {
        const supervisor = callbackOwner(scope)
        const solver = supervisor.getCandidate(id)
        if (action === "attach-general") {
          if (!(solver instanceof CachedIntraNodeRouteSolver))
            throw new Error(
              "Only General candidates can attach a General engine",
            )
          return { handle: solver.shareForPortfolio() }
        }
        if (action === "setup") {
          if ("setup" in solver && typeof solver.setup === "function")
            solver.setup()
        } else if (action === "step") {
          for (let index = 0; index < count; index++) solver.step()
        } else {
          throw new Error(`Unknown native portfolio action: ${action}`)
        }
        return getState(solver)
      },
      (
        id: number,
        action: "lookup" | "save",
        state: CandidateState,
      ): Record<string, unknown> => {
        const supervisor = callbackOwner(scope)
        const solver = supervisor.getCandidate(id)
        if (!(solver instanceof CachedIntraNodeRouteSolver)) {
          throw new Error(
            "Native portfolio requested a cache operation for a non-General candidate",
          )
        }
        syncState(solver, state)
        if (action === "lookup") {
          const hit = solver.attemptToUseCacheSync()
          refreshCacheCounts()
          return {
            hit,
            state: getState(solver),
            routes: hit ? solver.solvedRoutes : [],
          }
        }
        if (action !== "save")
          throw new Error(`Unknown binding portfolio cache action: ${action}`)
        solver.syncPortfolioOutput()
        solver.saveToCacheSync()
        refreshCacheCounts()
        return { hit: false, state: getState(solver), routes: [] }
      },
      (state: SolverStateSnapshot): { routes: unknown[]; solverType: string } =>
        callbackOwner(scope).completeSolve(state),
      enableNegotiatedSearch,
    )
  }

  private completeSolve(state: SolverStateSnapshot): {
    routes: unknown[]
    solverType: string
  } {
    this.synchronizing = true
    try {
      this.syncState(state)
      this.dirty = false
      const winner = this.owner.winningSolver
      let solverType = winner?.getSolverName() ?? this.owner.getSolverName()
      if (winner instanceof CachedIntraNodeRouteSolver) {
        const hp = winner.hyperParameters as Record<string, unknown>
        solverType = hp?.MULTI_HEAD_POLYLINE_SOLVER
          ? "MultiHeadPolyLineIntraNodeSolver3"
          : hp?.SINGLE_LAYER_NO_DIFFERENT_ROOT_INTERSECTIONS
            ? "SingleLayerNoDifferentRootIntersectionsIntraNodeSolver"
            : hp?.CLOSED_FORM_SINGLE_TRANSITION
              ? "SingleTransitionIntraNodeSolver"
              : hp?.CLOSED_FORM_TWO_TRACE_SAME_LAYER
                ? "TwoCrossingRoutesHighDensitySolver"
                : hp?.CLOSED_FORM_TWO_TRACE_TRANSITION_CROSSING
                  ? "SingleTransitionCrossingRouteSolver"
                  : hp?.HIGH_DENSITY_A01
                    ? "HighDensitySolverA01"
                    : hp?.HIGH_DENSITY_A03
                      ? "HighDensitySolverA03"
                      : "SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
        if (winner.cacheHit) solverType += " [cached]"
      }
      return { routes: state.solved ? this.owner.solvedRoutes : [], solverType }
    } finally {
      this.synchronizing = false
      this.stepping = false
      if (this.callbackScope.orchestrationKey !== undefined)
        this.executionScope?.release(this.callbackScope.orchestrationKey)
    }
  }

  shareForOrchestration(scope: PortfolioCallbackScope, key: number): number {
    if (!this.binding)
      throw new Error("Cannot share a disposed native portfolio")
    this.executionScope = scope
    this.callbackScope.orchestrationKey = key
    this.shared = true
    this.ownerDirty = true
    for (const field of [
      "iterations",
      "MAX_ITERATIONS",
      "solved",
      "failed",
      "error",
      "progress",
      "solvedRoutes",
      "GREEDY_MULTIPLIER",
      "MIN_SUBSTEPS",
    ] as const) {
      let value: unknown = this.owner[field]
      Object.defineProperty(this.owner, field, {
        enumerable: true,
        configurable: true,
        get: (): unknown => {
          if (!this.synchronizing && !this.stepping) {
            this.observed = true
            this.synchronize()
          }
          return value
        },
        set: (next: unknown): void => {
          if (!this.synchronizing && !this.stepping) {
            this.synchronize()
            this.ownerDirty = true
          }
          value = next
        },
      })
    }
    this.prepareSolverRun()
    return this.binding.shareForOrchestration()
  }

  prepareSolverRun(): void {
    if (!this.binding) return
    if (this.observed || this.ownerDirty || this.observedSpecializedCandidates)
      this.synchronize()
    this.stepping = true
    if (this.ownerDirty) {
      this.binding.restoreState({
        iterations: this.owner.iterations,
        MAX_ITERATIONS: this.owner.MAX_ITERATIONS,
        solved: this.owner.solved,
        failed: this.owner.failed,
        error: this.owner.error,
        progress: this.owner.progress,
        GREEDY_MULTIPLIER: this.owner.GREEDY_MULTIPLIER,
        MIN_SUBSTEPS: this.owner.MIN_SUBSTEPS,
      })
      this.ownerDirty = false
    }
    for (const [solver, id] of this.observedSpecializedCandidates ?? []) {
      solver.pushObservedDiagnostics()
      this.binding.setCandidateState(id, getState(solver as Candidate))
    }
  }

  finishSolverRun(): void {
    this.stepping = false
    this.dirty = true
  }

  syncObservedState(): void {
    if (this.observed) this.synchronize()
  }

  private observedGeneralCandidates?: Set<IntraNodeRouteSolver>
  private observedSpecializedCandidates?: Map<
    SpecializedIntraNodeSolverAdapter,
    number
  >
  private observeGeneralDiagnostics = (solver: IntraNodeRouteSolver): void => {
    ;(this.observedGeneralCandidates ??= new Set()).add(solver)
  }

  private installCandidateGetters(solver: Candidate, id: number): void {
    if (solver instanceof CachedIntraNodeRouteSolver)
      solver.setDiagnosticObserver(this.observeGeneralDiagnostics)
    const observeSpecialized = (): void => {
      if (this.synchronizing) return
      if (solver instanceof SpecializedIntraNodeSolverAdapter) {
        ;(this.observedSpecializedCandidates ??= new Map()).set(solver, id)
      }
    }
    if (solver instanceof SpecializedIntraNodeSolverAdapter)
      solver.setDiagnosticObserver(observeSpecialized)
    const candidate = solver as unknown as Record<string, unknown>
    const keys = [
      "iterations",
      "MAX_ITERATIONS",
      "solved",
      "failed",
      "error",
      "progress",
    ]
    if (solver instanceof CachedIntraNodeRouteSolver) keys.push("solvedRoutes")
    if (solver instanceof HighDensitySolverAdapter)
      keys.push("solvedSegmentCount")
    for (const key of keys) {
      let value = candidate[key]
      Object.defineProperty(solver, key, {
        configurable: true,
        enumerable: true,
        get: (): unknown => {
          if (this.shared && !this.stepping && !this.synchronizing)
            this.observed = true
          this.synchronize()
          return value
        },
        set: (next: unknown): void => {
          if (!this.synchronizing && !this.stepping) {
            this.synchronize()
            if (next !== value) observeSpecialized()
          }
          value = next
          if (!this.synchronizing && !this.stepping)
            this.binding!.setCandidateState(id, getState(solver))
        },
      })
    }
  }

  private getCandidate(id: number): Candidate {
    const solver = this.candidates[id]
    if (!solver) throw new Error(`Unknown binding portfolio candidate: ${id}`)
    return solver
  }

  step(): void {
    const binding = this.binding
    if (!binding)
      throw new Error("Native portfolio supervisor has been disposed")
    try {
      if (this.observedSpecializedCandidates) {
        this.synchronize()
        for (const [solver, id] of this.observedSpecializedCandidates) {
          solver.pushObservedDiagnostics()
          binding.setCandidateState(id, getState(solver as Candidate))
        }
      }
      if (
        this.owner.GREEDY_MULTIPLIER !== this.greedyMultiplier ||
        this.owner.MIN_SUBSTEPS !== this.minSubsteps
      ) {
        this.greedyMultiplier = this.owner.GREEDY_MULTIPLIER
        this.minSubsteps = this.owner.MIN_SUBSTEPS
        binding.configure(this.greedyMultiplier, this.minSubsteps)
      }
      this.stepping = true
      this.callbackScope.current = this
      let status: number
      try {
        status = binding.step(this.owner.iterations)
      } finally {
        this.callbackScope.current = undefined
        this.stepping = false
      }
      this.dirty = true
      if (this.observedGeneralCandidates) {
        for (const solver of this.observedGeneralCandidates)
          solver.syncObservedDiagnostics()
      }
      if (this.observedSpecializedCandidates) {
        this.synchronizing = true
        try {
          for (const solver of this.observedSpecializedCandidates.keys())
            solver.syncObservedDiagnostics()
        } finally {
          this.synchronizing = false
        }
      }
      this.synchronizing = true
      this.owner.MAX_ITERATIONS = binding.maxIterations()
      this.owner.solved = (status & 1) !== 0
      this.owner.failed = (status & 2) !== 0
      this.synchronizing = false
      if (this.owner.solved || this.owner.failed) {
        this.synchronize()
        if (!this.shared) this.dispose()
      }
    } catch (error) {
      this.dispose()
      throw error
    }
  }

  synchronize(): void {
    if (!this.binding || !this.dirty || this.synchronizing || this.stepping)
      return
    this.synchronizing = true
    try {
      this.bestId = this.binding.bestCandidateId()
      this.syncState(this.binding.snapshot())
      this.dirty = false
    } finally {
      this.synchronizing = false
    }
  }

  initialize(): void {
    if (!this.binding)
      throw new Error("Native portfolio supervisor has been disposed")
    this.stepping = true
    this.callbackScope.current = this
    try {
      this.binding.initialize()
    } finally {
      this.callbackScope.current = undefined
      this.stepping = false
    }
    this.dirty = true
    this.synchronize()
  }

  getHyperParameterDefs(): Array<{
    name: string
    possibleValues: Record<string, unknown>[]
  }> {
    return bindings.PortfolioSingleIntraNodeSolver.getHyperParameterDefs()
  }

  getCombinationDefs(): string[][] {
    return bindings.PortfolioSingleIntraNodeSolver.getCombinationDefs(
      this.owner.enableNegotiatedSearch,
    )
  }

  getHyperParameterCombinations(
    definitions = this.getHyperParameterDefs(),
  ): Record<string, unknown>[] {
    return bindings.PortfolioSingleIntraNodeSolver.getHyperParameterCombinations(
      definitions,
    )
  }

  getBestCandidate(): SupervisedCandidate | null {
    this.synchronize()
    return this.bestId === undefined
      ? null
      : (this.supervisedById.get(this.bestId) ?? null)
  }

  getFailureMessage(): string {
    if (!this.binding) return this.owner.error ?? ""
    const message = this.binding.failureMessage()
    this.dirty = true
    this.synchronize()
    return message
  }

  computeF(g: number, h: number): number {
    return bindings.PortfolioSingleIntraNodeSolver.computeF(
      g,
      h,
      this.owner.GREEDY_MULTIPLIER,
    )
  }

  computeG(solver: Candidate): number {
    const hyperParameters =
      "hyperParameters" in solver ? solver.hyperParameters : {}
    return bindings.PortfolioSingleIntraNodeSolver.computeCandidateG(
      getState(solver),
      hyperParameters,
      solver instanceof HighDensitySolverAdapter,
    )
  }

  computeH(solver: Candidate): number {
    return bindings.PortfolioSingleIntraNodeSolver.computeCandidateH(
      getState(solver),
      this.owner.nodeWithPortPoints,
      this.owner.adaptiveSearchExpanded,
    )
  }

  canDisposeUnobserved(): boolean {
    return (
      !this.observed &&
      !this.ownerDirty &&
      !this.observedGeneralCandidates?.size &&
      !this.observedSpecializedCandidates?.size &&
      !Object.hasOwn(this.owner, "generateSolver") &&
      !Object.hasOwn(this.owner, "onSolve") &&
      this.candidates.every(
        (candidate): boolean =>
          candidate instanceof IntraNodeRouteSolver ||
          candidate instanceof SpecializedIntraNodeSolverAdapter ||
          candidate instanceof HighDensitySolverAdapter,
      )
    )
  }

  disposeUnobserved(): boolean {
    if (!this.canDisposeUnobserved()) return false
    // Called only after the native parent has released its active child borrow.
    for (const candidate of this.candidates) {
      if (
        candidate instanceof IntraNodeRouteSolver ||
        candidate instanceof SpecializedIntraNodeSolverAdapter ||
        candidate instanceof HighDensitySolverAdapter
      )
        candidate.dispose()
    }
    this.dispose()
    return true
  }

  dispose(): void {
    this.binding?.free()
    this.binding = undefined
  }

  private syncState(state: SolverStateSnapshot): void {
    if (this.shared) {
      this.owner.iterations = state.iterations
      this.owner.progress =
        state.progress === null ? Number.NaN : state.progress
    }
    for (const candidate of state.candidates) {
      const solver = this.getCandidate(candidate.id)
      syncState(solver, candidate.state)
      if (
        solver instanceof CachedIntraNodeRouteSolver &&
        candidate.id === state.activeId
      )
        solver.syncPortfolioOutput()
      const entry = this.supervisedById.get(candidate.id) ?? {
        solver,
        hyperParameters: candidate.hyperParameters,
        g: 0,
        h: 0,
        f: 0,
      }
      if (!this.supervisedById.has(candidate.id)) {
        for (const key of ["g", "h", "f"] as const) {
          let value = entry[key]
          Object.defineProperty(entry, key, {
            configurable: true,
            enumerable: true,
            get: (): number => {
              this.synchronize()
              return value
            },
            set: (next: number): void => {
              value = next
            },
          })
        }
      }
      entry.g = candidate.g
      entry.h = candidate.h
      entry.f = candidate.f
      this.supervisedById.set(candidate.id, entry)
    }
    this.owner.supervisedSolvers = state.order.map((id) => {
      const entry = this.supervisedById.get(id)
      if (!entry)
        throw new Error(
          `Native portfolio order references an unknown candidate: ${id}`,
        )
      return entry
    })
    this.owner.solved = state.solved
    this.owner.failed = state.failed
    this.owner.error = state.error
    this.owner.MAX_ITERATIONS = state.MAX_ITERATIONS
    Object.assign(this.owner.stats, state.stats)
    this.owner.adaptiveSearchExpanded = state.adaptiveSearchExpanded
    this.owner.negotiatedSearchStarted = state.negotiatedSearchStarted
    this.owner.activeSubSolver =
      state.activeId === null ? undefined : this.getCandidate(state.activeId)
    if (state.winnerId !== null && !this.owner.winningSolver) {
      const winner = this.getCandidate(state.winnerId)
      this.owner.winningSolver = winner
      const supervised = this.owner.supervisedSolvers.find(
        (entry) => entry.solver === winner,
      )
      if (!supervised)
        throw new Error(
          "Native portfolio winner is missing from its candidates",
        )
      this.owner.onSolve(supervised)
    }
  }
}
