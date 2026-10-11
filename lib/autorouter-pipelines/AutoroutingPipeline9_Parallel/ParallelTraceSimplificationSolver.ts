import { MultiSimplifiedPathSolver, TraceSimplificationSolver } from "@tscircuit/trace-simplification-solver"
import type { ParallelStageWorkerPool } from "./parallelStageWorkerTypes"
import { ParallelMultiSimplifiedPathSolver } from "./ParallelMultiSimplifiedPathSolver"
import { PhysicalTraceSimplificationSolver, type PhysicalSimplificationParams } from "./PhysicalTraceSimplificationSolver"

type Params = PhysicalSimplificationParams & {
  workerPool: ParallelStageWorkerPool
  workerCount: number
}

/** Keep all coordinated via operations and validation in the original solver. */
export class ParallelTraceSimplificationSolver extends PhysicalTraceSimplificationSolver {
  readonly workerPool: ParallelStageWorkerPool
  readonly workerCount: number
  private readonly harvestedPathDiagnostics = new WeakSet<ParallelMultiSimplifiedPathSolver>()

  constructor({ workerPool, workerCount, ...params }: Params) {
    super(params)
    this.workerPool = workerPool
    this.workerCount = workerCount
    this.pendingEffects = []
    this.stats = {
      ...this.stats,
      pathSimplificationPhaseCount: 0,
      parallelPathBatchCountMax: 0,
      interactionComponentCountMax: 0,
      componentJobs: 0,
    }
  }

  override getSolverName(): string {
    return "ParallelTraceSimplificationSolver"
  }

  override _step(): void {
    if (this.simplificationPipelineLoops >= this.MAX_SIMPLIFICATION_PIPELINE_LOOPS) {
      super._step()
      this.pendingEffects = this.activeSubSolver?.pendingEffects ?? []
      return
    }
    const active = this.activeSubSolver
    if (active instanceof MultiSimplifiedPathSolver && !(active instanceof ParallelMultiSimplifiedPathSolver)) {
      const pathSolver = new ParallelMultiSimplifiedPathSolver({
        unsimplifiedHdRoutes: active.unsimplifiedHdRoutes,
        otherHdRoutes: active.otherHdRoutes,
        obstacles: active.obstacles,
        connMap: active.connMap,
        colorMap: active.colorMap,
        outline: active.outline,
        minBoardEdgeClearance: active.minBoardEdgeClearance,
        defaultViaDiameter: active.defaultViaDiameter,
        useTraceWidthAwareClearance: active.useTraceWidthAwareClearance,
        enableVertexShortcuts: active.enableVertexShortcuts,
        preserveLeadingLayerTransitions: this.requiresPhysicalCopperTransitions,
        workerPool: this.workerPool,
        workerCount: this.workerCount,
        useCertifiedLookahead: true,
      })
      this.activeSubSolver = pathSolver
      this.stats.pathSimplificationPhaseCount++
      this.stats.parallelPathBatchCountMax = Math.max(this.stats.parallelPathBatchCountMax, pathSolver.batches.length)
      this.stats.interactionComponentCountMax = Math.max(this.stats.interactionComponentCountMax, pathSolver.stats.interactionComponentCount)
      if (pathSolver.batches.length > 1) this.stats.componentJobs += pathSolver.batches.length
    }
    this.prepareSimplificationChild()
    const subSolver = this.activeSubSolver
    if (subSolver && (!(subSolver instanceof ParallelMultiSimplifiedPathSolver) || !subSolver.hasParallelWork)) {
      // These children have no asynchronous work. Use their own solve loops
      // and iteration budgets, then let the original parent validate and
      // harvest the finished phase exactly as it does during stepped solving.
      subSolver.solve()
    }
    super._step()
    if (subSolver instanceof ParallelMultiSimplifiedPathSolver && subSolver.solved &&
      !this.harvestedPathDiagnostics.has(subSolver)) {
      this.harvestedPathDiagnostics.add(subSolver)
      for (const [key, value] of Object.entries(subSolver.stats)) {
        if (!key.startsWith("lookahead") || typeof value !== "number") continue
        if (key === "lookaheadMaximumLookahead") this.stats[key] = Math.max(this.stats[key] ?? 0, value)
        else this.stats[key] = (this.stats[key] ?? 0) + value
      }
    }
    this.pendingEffects = this.activeSubSolver?.pendingEffects ?? []
  }

  override solve(): void {
    throw new Error("Parallel trace simplification requires solveAsync() or awaiting pendingEffects")
  }

  async solveAsync(): Promise<void> {
    while (!this.solved && !this.failed) {
      this.step()
      await Promise.all(this.pendingEffects!.map((effect) => effect.promise))
    }
    if (this.failed) throw new Error(`Parallel trace simplification failed: ${this.error}`)
  }
}
