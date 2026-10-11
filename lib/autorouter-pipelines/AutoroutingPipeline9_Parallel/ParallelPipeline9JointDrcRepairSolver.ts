import { getPendingEffectsFromSolverTree } from "../../solvers/getPendingEffectsFromSolverTree"
import { Pipeline9JointDrcRepairSolver } from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { Pipeline9RegionalB01RepairSolver } from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalB01RepairSolver"
import { Pipeline9BoundedRegionalRepairSolver } from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { ParallelPipeline9RegionalB01RepairSolver } from "./ParallelPipeline9RegionalB01RepairSolver"
import { Pipeline9DenseBoundedRegionalRepairSolver } from "./Pipeline9DenseBoundedRegionalRepairSolver"
import type { ParallelStageWorkerPool } from "./parallelStageWorkerTypes"

type Params = ConstructorParameters<typeof Pipeline9JointDrcRepairSolver>[0] & {
  workerPool: ParallelStageWorkerPool
}

export class ParallelPipeline9JointDrcRepairSolver extends Pipeline9JointDrcRepairSolver {
  readonly workerPool: ParallelStageWorkerPool

  constructor({ workerPool, ...params }: Params) {
    super(params)
    this.workerPool = workerPool
    this.pendingEffects = []
  }

  protected override createRegionalB01RepairSolver(
    params: ConstructorParameters<typeof Pipeline9RegionalB01RepairSolver>[0],
  ): Pipeline9RegionalB01RepairSolver {
    // The shared pool keeps ordinary routing and regional speculation within the
    // same worker limit; the joint coordinator retains all final reference checks.
    return new ParallelPipeline9RegionalB01RepairSolver({ ...params, workerPool: this.workerPool })
  }

  protected override createBoundedRegionalRepairSolver(
    params: ConstructorParameters<typeof Pipeline9BoundedRegionalRepairSolver>[0],
  ): Pipeline9BoundedRegionalRepairSolver {
    // The local implementation preserves the negotiation sequence and budgets
    // while replacing repeated exact path-search queries with dense caches.
    return new Pipeline9DenseBoundedRegionalRepairSolver(params)
  }

  override solve(): void {
    throw new Error("Parallel joint DRC repair requires solveAsync() or awaiting pendingEffects")
  }

  override _step(): void {
    const child = this.activeSubSolver
    if (child && !(child instanceof ParallelPipeline9RegionalB01RepairSolver)) {
      child.solve()
    }
    // Keep the original coordinator's failure, publication and budget handling.
    super._step()
  }

  async solveAsync(): Promise<void> {
    const startedAt = performance.now()
    while (!this.solved && !this.failed) {
      this.step()
      const effects = getPendingEffectsFromSolverTree(this)
      if (effects.length > 0) await Promise.all(effects.map((effect) => effect.promise))
    }
    this.timeToSolve = performance.now() - startedAt
  }
}
