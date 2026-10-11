import { TinyHyperGraphSolver, type TinyHyperGraphSectionPipelineInput, type TinyHyperGraphTopology, type TinyHyperGraphProblem, type TinyHyperGraphSolverOptions } from "tiny-hypergraph/lib/index"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { TinyBitsetHyperGraphSolver } from "./TinyBitsetHyperGraphSolver"
import { TinyBitsetSelectiveReripHyperGraphSolver } from "./TinyBitsetSelectiveReripHyperGraphSolver"
import { TinyIndexedSelectiveReripHyperGraphSolver } from "./TinyIndexedSelectiveReripHyperGraphSolver"
import { TinyLandmarkHyperGraphSolver } from "./TinyLandmarkHyperGraphSolver"
import { TinyLandmarkSelectiveReripHyperGraphSolver } from "./TinyLandmarkSelectiveReripHyperGraphSolver"
import { TinyNegotiatedHyperGraphSolver } from "./TinyNegotiatedHyperGraphSolver"
import { TinyGoalBallSelectiveReripHyperGraphSolver } from "./TinyGoalBallSelectiveReripHyperGraphSolver"
import type { ParallelStageWorkerPool } from "./parallelStageWorkerTypes"

export type Pipeline9PathingStrategy = "indexed" | "adaptive-bitset" | "cached-cost" | "landmark" | "negotiated" | "goal-balls"
export type Pipeline9PathingOptions = { strategy?: Pipeline9PathingStrategy; workerPool?: ParallelStageWorkerPool }
type TinyPipeline = ReturnType<TinyHypergraphPortPointPathingSolver["createTinyPipeline"]>

class CachedCostHyperGraphSolver extends TinyBitsetHyperGraphSolver {
  constructor(topology: TinyHyperGraphTopology, problem: TinyHyperGraphProblem, options?: TinyHyperGraphSolverOptions) {
    super(topology, problem, options, {
      minimumBitsetSegmentCount: Number.POSITIVE_INFINITY, enableRegionCostCache: true,
    })
  }
}

class CachedCostSelectiveHyperGraphSolver extends TinyBitsetSelectiveReripHyperGraphSolver {
  constructor(topology: TinyHyperGraphTopology, problem: TinyHyperGraphProblem, options?: TinyHyperGraphSolverOptions) {
    super(topology, problem, options, {
      minimumBitsetSegmentCount: Number.POSITIVE_INFINITY, enableRegionCostCache: true,
    })
  }
}

export class ParallelPortPointPathingSolver extends TinyHypergraphPortPointPathingSolver {
  // The base constructor calls createTinyPipeline before subclass initialization.
  // A declare-only capture survives that call; configure it before routing begins.
  declare private createdTinyPipeline: TinyPipeline
  private pathingStrategy?: Pipeline9PathingStrategy
  private readonly workerPool?: ParallelStageWorkerPool
  readonly requiresAsyncExecution: boolean

  constructor(
    params: ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>[0],
    options: Pipeline9PathingOptions = {},
  ) {
    super(params)
    this.pathingStrategy = options.strategy ?? "indexed"
    this.workerPool = options.workerPool
    this.requiresAsyncExecution = this.pathingStrategy === "negotiated" ||
      ((this.pathingStrategy === "landmark" || this.pathingStrategy === "goal-balls") && this.workerPool !== undefined)
    this.configureTinyPipeline(this.createdTinyPipeline, this.pathingStrategy)
  }

  protected override createTinyPipeline(
    inputProblem: TinyHyperGraphSectionPipelineInput,
    useSelectiveReripRouting: boolean,
  ): TinyPipeline {
    const pipeline = super.createTinyPipeline(inputProblem, useSelectiveReripRouting)
    this.createdTinyPipeline = pipeline
    if (this.pathingStrategy !== undefined) this.configureTinyPipeline(pipeline, this.pathingStrategy)
    return pipeline
  }

  private configureTinyPipeline(pipeline: TinyPipeline, strategy: Pipeline9PathingStrategy): void {
    const solveGraphStep = pipeline.pipelineDef.find((step) => step.solverName === "solveGraph")
    if (!solveGraphStep) throw new Error("Tiny hypergraph pipeline is missing the solveGraph stage")
    const selective = pipeline.useSelectiveReripRouting
    switch (strategy) {
      case "indexed":
        solveGraphStep.solverClass = selective ? TinyIndexedSelectiveReripHyperGraphSolver : TinyHyperGraphSolver
        return
      case "adaptive-bitset":
        solveGraphStep.solverClass = selective ? TinyBitsetSelectiveReripHyperGraphSolver : TinyBitsetHyperGraphSolver
        return
      case "cached-cost":
        solveGraphStep.solverClass = selective ? CachedCostSelectiveHyperGraphSolver : CachedCostHyperGraphSolver
        return
      case "landmark":
        solveGraphStep.solverClass = selective ? TinyLandmarkSelectiveReripHyperGraphSolver : TinyLandmarkHyperGraphSolver
        return
      case "negotiated":
        if (!selective) throw new Error("Negotiated Pipeline9 pathing requires selective rerip routing")
        solveGraphStep.solverClass = TinyNegotiatedHyperGraphSolver
        return
      case "goal-balls":
        if (!selective) throw new Error("Goal-ball Pipeline9 pathing requires selective rerip routing")
        solveGraphStep.solverClass = TinyGoalBallSelectiveReripHyperGraphSolver
        return
      default:
        throw new Error(`Unknown Pipeline9 pathing strategy: ${strategy}`)
    }
  }

  private prepareGoalBalls(pipeline: TinyPipeline): void {
    const tiny = pipeline.getSolver<TinyGoalBallSelectiveReripHyperGraphSolver>("solveGraph")
    if (!tiny) return
    if (this.pendingEffects && this.pendingEffects.length > 0) return
    const heuristic = tiny.goalBallHeuristic
    const recordPreparation = (): void => {
      pipeline.stats = { ...pipeline.stats, ...heuristic.stats }
      this.pendingEffects = []
    }
    let promise: Promise<void> | undefined
    if (!heuristic.landmarkHeuristic.ready) {
      promise = heuristic.prepareLandmarks(this.workerPool)
      if (!promise) recordPreparation()
    } else if (tiny.needsCompletionGoalPreparation) {
      if (this.workerPool) promise = heuristic.prepare(this.workerPool)
      else { heuristic.prepareSync(); recordPreparation() }
    }
    if (!promise) return
    this.pendingEffects = [{ name: "parallel-pathing-goal-balls", promise: promise.then(recordPreparation)
      .catch((error: unknown): never => {
        this.failed = true
        this.error = error instanceof Error ? error.message : String(error)
        throw error
      }) }]
  }

  private prepareLandmarks(pipeline: TinyPipeline): void {
    const tiny = pipeline.getSolver<TinyLandmarkHyperGraphSolver | TinyLandmarkSelectiveReripHyperGraphSolver>("solveGraph")
    if (!tiny) return
    const heuristic = tiny.landmarkHeuristic
    if (heuristic.ready) return
    const recordPreparation = (): void => {
      pipeline.stats = { ...pipeline.stats, ...heuristic.stats }
      this.pendingEffects = []
    }
    if (!this.workerPool) {
      heuristic.prepareSync()
      recordPreparation()
      return
    }
    if (this.pendingEffects && this.pendingEffects.length > 0) return
    const promise = heuristic.prepare(this.workerPool).then(recordPreparation).catch((error: unknown): never => {
      this.failed = true
      this.error = error instanceof Error ? error.message : String(error)
      throw error
    })
    this.pendingEffects = [{ name: "parallel-pathing-landmarks", promise }]
  }

  override _step(): void {
    if (this.pathingStrategy === "goal-balls") {
      this.prepareGoalBalls(this.createdTinyPipeline)
      if (this.pendingEffects && this.pendingEffects.length > 0) return
      super._step()
      this.prepareGoalBalls(this.createdTinyPipeline)
      return
    }
    if (this.pathingStrategy === "negotiated") {
      const tiny = this.createdTinyPipeline.getSolver<TinyNegotiatedHyperGraphSolver>("solveGraph")
      if (tiny) {
        if (!this.workerPool) throw new Error("Negotiated Pipeline9 pathing requires a worker pool")
        tiny.configureWorkerPool(this.workerPool)
        if (tiny.pendingEffects.length > 0) { this.pendingEffects = tiny.pendingEffects; return }
      }
      super._step()
      const activeTiny = this.createdTinyPipeline.getSolver<TinyNegotiatedHyperGraphSolver>("solveGraph")
      this.pendingEffects = activeTiny?.pendingEffects ?? []
      return
    }
    if (this.pathingStrategy !== "landmark") {
      super._step()
      return
    }
    this.prepareLandmarks(this.createdTinyPipeline)
    if (this.pendingEffects && this.pendingEffects.length > 0) return
    super._step()
    // The section pipeline constructs its child on one step and starts routing
    // on the next. Publish the preparation effect before that first route step.
    this.prepareLandmarks(this.createdTinyPipeline)
  }

  override solve(): void {
    if (this.requiresAsyncExecution) throw new Error("Parallel pathing requires solveAsync() or awaiting pendingEffects")
    super.solve()
  }

  async solveAsync(): Promise<void> {
    while (!this.solved && !this.failed) {
      this.step()
      if (this.pendingEffects && this.pendingEffects.length > 0) {
        await Promise.all(this.pendingEffects.map((effect) => effect.promise))
      }
    }
  }
}
