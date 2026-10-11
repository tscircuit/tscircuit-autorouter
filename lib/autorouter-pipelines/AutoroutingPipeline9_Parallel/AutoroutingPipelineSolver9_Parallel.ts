import type { SimpleRouteJson } from "../../types/srj-types"
import { getPendingEffectsFromSolverTree } from "../../solvers/getPendingEffectsFromSolverTree"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph, type AutoroutingPipelineSolverOptions } from "../AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9LocalWorkerPool } from "./Pipeline9LocalWorkerPool"
import { Pipeline9ParallelHighDensitySolver } from "./Pipeline9ParallelHighDensitySolver"
import { ParallelHighDensityForceImproveSolver } from "./ParallelHighDensityForceImproveSolver"
import { ParallelHighDensityRepairSolver } from "./ParallelHighDensityRepairSolver"
import { ParallelTraceSimplificationSolver } from "./ParallelTraceSimplificationSolver"
import { ParallelPortPointPathingSolver, type Pipeline9PathingStrategy } from "./ParallelPortPointPathingSolver"
import { ParallelPipeline9JointDrcRepairSolver } from "./ParallelPipeline9JointDrcRepairSolver"
import type { ParallelHighDensityPolicy } from "./parallelHighDensityPolicyTypes"
import { Pipeline9LayerAwareNetToPointPairsSolver } from "./Pipeline9LayerAwareNetToPointPairsSolver"

export type AutoroutingPipelineSolver9ParallelOptions = AutoroutingPipelineSolverOptions & {
  workerCount?: number
  pathingStrategy?: Pipeline9PathingStrategy
  /** Supply a persistent pool to reuse worker imports across boards. */
  workerPool?: Pipeline9LocalWorkerPool
  enableParallelPathSimplification?: boolean
  highDensityPolicy?: ParallelHighDensityPolicy
}

/** Opt-in Pipeline9 prototype using at most four local routing workers. */
export class AutoroutingPipelineSolver9_Parallel extends AutoroutingPipelineSolver9_PreloadedTraceGraph {
  readonly workerPool: Pipeline9LocalWorkerPool
  private readonly ownsWorkerPool: boolean

  constructor(srj: SimpleRouteJson, opts: AutoroutingPipelineSolver9ParallelOptions = {}) {
    super(srj, opts)
    if (opts.highDensityPolicy !== undefined && opts.highDensityPolicy !== "ordered" && opts.highDensityPolicy !== "first-valid") {
      throw new Error(`Invalid parallel high-density policy: ${opts.highDensityPolicy}`)
    }
    this.workerPool = opts.workerPool ?? new Pipeline9LocalWorkerPool({ workerCount: opts.workerCount })
    this.ownsWorkerPool = opts.workerPool === undefined
    if (opts.highDensityPolicy === "first-valid" || opts.pathingStrategy === "landmark" || opts.pathingStrategy === "negotiated") {
      const pairsIndex = this.pipelineDef.findIndex((step) => step.solverName === "netToPointPairsSolver")
      const pairsStep = this.pipelineDef[pairsIndex]
      if (!pairsStep) throw new Error("Pipeline9 netToPointPairsSolver step is missing")
      this.pipelineDef[pairsIndex] = { ...pairsStep, solverClass: Pipeline9LayerAwareNetToPointPairsSolver as any } as any
      const stitchIndex = this.pipelineDef.findIndex((step) => step.solverName === "highDensityStitchSolver")
      const stitchStep = this.pipelineDef[stitchIndex]
      if (!stitchStep) throw new Error("Pipeline9 highDensityStitchSolver step is missing")
      this.pipelineDef[stitchIndex] = { ...stitchStep,
        getConstructorParams: (cms: AutoroutingPipelineSolver9_PreloadedTraceGraph): any[] => {
          const params = stitchStep.getConstructorParams(cms)
          return [{ ...params[0], snapTerminalsOnSameLayer: true }]
        },
      } as any
    }
    const pathingIndex = this.pipelineDef.findIndex((step) => step.solverName === "portPointPathingSolver")
    const pathingStep = this.pipelineDef[pathingIndex]
    if (!pathingStep) throw new Error("Pipeline9 portPointPathingSolver step is missing")
    this.pipelineDef[pathingIndex] = {
      ...pathingStep, solverClass: ParallelPortPointPathingSolver as any,
      getConstructorParams: (cms: AutoroutingPipelineSolver9_PreloadedTraceGraph): any[] => [
        ...pathingStep.getConstructorParams(cms), { strategy: opts.pathingStrategy ?? "indexed", workerPool: this.workerPool },
      ],
    } as any
    const stepIndex = this.pipelineDef.findIndex((step) => step.solverName === "highDensityRouteSolver")
    const originalStep = this.pipelineDef[stepIndex]
    if (!originalStep) throw new Error("Pipeline9 highDensityRouteSolver step is missing")
    const getOriginalParams = originalStep.getConstructorParams
    this.pipelineDef[stepIndex] = {
      ...originalStep, solverClass: Pipeline9ParallelHighDensitySolver as any,
      getConstructorParams: (solver: AutoroutingPipelineSolver9_Parallel) => {
        const [params] = getOriginalParams(solver)
        return [{ ...params, workerPool: solver.workerPool, highDensityPolicy: opts.highDensityPolicy ?? "ordered",
          firstValidClearance: Math.max(0.1, solver.srj.minTraceToPadEdgeClearance ?? 0.1,
            solver.srj.minViaEdgeToPadEdgeClearance ?? 0.1) }]
      },
    } as any
    for (const [solverName, solverClass] of [
      ["highDensityForceImproveSolver", ParallelHighDensityForceImproveSolver],
      ["highDensityRepairSolver", ParallelHighDensityRepairSolver],
      ["pipeline9JointDrcRepairSolver", ParallelPipeline9JointDrcRepairSolver],
    ] as const) {
      const stageIndex = this.pipelineDef.findIndex((step) => step.solverName === solverName)
      const originalStage = this.pipelineDef[stageIndex]
      if (!originalStage) throw new Error(`Pipeline9 ${solverName} step is missing`)
      const getStageParams = originalStage.getConstructorParams
      this.pipelineDef[stageIndex] = {
        ...originalStage, solverClass: solverClass as any,
        getConstructorParams: (solver: AutoroutingPipelineSolver9_Parallel) => {
          const [params] = getStageParams(solver)
          return [{ ...params, workerPool: solver.workerPool }]
        },
      } as any
    }
    if (opts.enableParallelPathSimplification) {
      for (const solverName of ["traceSimplificationSolver", "mutatedPreloadedTraceSimplificationSolver"] as const) {
        const stageIndex = this.pipelineDef.findIndex((step) => step.solverName === solverName)
        const originalStage = this.pipelineDef[stageIndex]
        if (!originalStage) throw new Error(`Pipeline9 ${solverName} step is missing`)
        const getStageParams = originalStage.getConstructorParams
        this.pipelineDef[stageIndex] = {
          ...originalStage, solverClass: ParallelTraceSimplificationSolver as any,
          getConstructorParams: (solver: AutoroutingPipelineSolver9_Parallel) => {
            const [params] = getStageParams(solver)
            return [{ ...params, workerPool: solver.workerPool, workerCount: solver.workerPool.workerCount }]
          },
        } as any
      }
    }
  }

  override getSolverName(): string {
    return "AutoroutingPipelineSolver9_Parallel"
  }

  private failAsyncExecution(error: unknown): never {
    this.failed = true
    const detail = error instanceof Error ? error.message : String(error)
    this.error = `${this.getSolverName()} error: ${detail}`
    throw error
  }

  async stepAsync(): Promise<void> {
    if (this.solved || this.failed) return
    try {
      this.step()
      const effects = getPendingEffectsFromSolverTree(this)
      if (effects.length > 0) await Promise.race(effects.map((effect) => effect.promise))
      if (effects.length > 0 && !this.solved && !this.failed) this.step()
    } catch (error: unknown) {
      this.failAsyncExecution(error)
    }
  }

  async solveAsync(): Promise<void> {
    const startTime = performance.now()
    try {
      while (!this.solved && !this.failed) {
        if (this.activeSubSolver instanceof ParallelPortPointPathingSolver && this.activeSubSolver.requiresAsyncExecution) {
          await this.activeSubSolver.solveAsync()
          this.step()
          continue
        }
        // Serial stages retain their own step budget and progress updates; the
        // coordinator only needs to commit the stage once it finishes.
        if (this.activeSubSolver &&
          !(this.activeSubSolver instanceof Pipeline9ParallelHighDensitySolver) &&
          !(this.activeSubSolver instanceof ParallelHighDensityForceImproveSolver) &&
          !(this.activeSubSolver instanceof ParallelHighDensityRepairSolver) &&
          !(this.activeSubSolver instanceof ParallelPipeline9JointDrcRepairSolver) &&
          !(this.activeSubSolver instanceof ParallelTraceSimplificationSolver)) {
          this.activeSubSolver.solve()
          this.step()
          continue
        }
        this.step()
        const effects = getPendingEffectsFromSolverTree(this)
        if (effects.length > 0) await Promise.race(effects.map((effect) => effect.promise))
      }
    } catch (error: unknown) {
      this.failAsyncExecution(error)
    } finally {
      this.timeToSolve = performance.now() - startTime
    }
  }

  async solveUntilPhaseAsync(phase: string): Promise<void> {
    try {
      while (this.getCurrentPhase() !== phase && !this.solved && !this.failed) {
        this.step()
        const effects = getPendingEffectsFromSolverTree(this)
        if (effects.length > 0) await Promise.race(effects.map((effect) => effect.promise))
      }
    } catch (error: unknown) {
      this.failAsyncExecution(error)
    }
  }

  dispose(): void {
    if (this.ownsWorkerPool) this.workerPool.dispose()
  }

  override solve(): void {
    throw new Error("AutoroutingPipelineSolver9_Parallel requires async execution. Use solveAsync() or stepAsync().")
  }

  override solveUntilPhase(_phase: string): void {
    throw new Error("AutoroutingPipelineSolver9_Parallel requires solveUntilPhaseAsync().")
  }
}
