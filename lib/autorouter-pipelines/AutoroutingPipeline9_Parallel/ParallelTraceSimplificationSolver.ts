import { MultiSimplifiedPathSolver, TraceSimplificationSolver } from "@tscircuit/trace-simplification-solver"
import type { ParallelStageWorkerPool } from "./parallelStageWorkerTypes"
import { ParallelMultiSimplifiedPathSolver } from "./ParallelMultiSimplifiedPathSolver"

type Params = ConstructorParameters<typeof TraceSimplificationSolver>[0] & {
  workerPool: ParallelStageWorkerPool
  workerCount: number
}

/** Keep all coordinated via operations and validation in the original solver. */
export class ParallelTraceSimplificationSolver extends TraceSimplificationSolver {
  readonly workerPool: ParallelStageWorkerPool
  readonly workerCount: number

  constructor({ workerPool, workerCount, ...params }: Params) {
    super(params)
    this.workerPool = workerPool
    this.workerCount = workerCount
    this.pendingEffects = []
  }

  override getSolverName(): string {
    return "ParallelTraceSimplificationSolver"
  }

  override _step(): void {
    const active = this.activeSubSolver
    if (active instanceof MultiSimplifiedPathSolver && !(active instanceof ParallelMultiSimplifiedPathSolver)) {
      this.activeSubSolver = new ParallelMultiSimplifiedPathSolver({
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
        workerPool: this.workerPool,
        workerCount: this.workerCount,
      })
    }
    super._step()
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
