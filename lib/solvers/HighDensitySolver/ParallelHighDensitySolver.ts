import { WebWorkerHighDensitySolverExecutor } from "../../WebWorkerHighDensitySolverExecutor"
import { executeTasksWithConcurrency } from "../../utils/executeTasksWithConcurrency"
import type { PendingEffect } from "../BaseSolver"
import { solveSolverAsync, stepSolverAsync } from "../runSolverAsync"
import {
  HighDensitySolver,
  type HighDensitySolverParams,
} from "./HighDensitySolver"
import { FailedHighDensityNodeSolver } from "./FailedHighDensityNodeSolver"
import type {
  HighDensityNodeSolveResult,
  HighDensityNodeSolveTask,
  HighDensitySolverExecutionContext,
  HighDensitySolverExecutor,
  HighDensitySolverExecutorSession,
} from "./high-density-parallel-types"

export interface ParallelHighDensitySolverParams
  extends HighDensitySolverParams {
  parallelism?: number
  executor?: HighDensitySolverExecutor
  workerUrl?: string
}

/**
 * Async orchestration for independent high-density nodes. The intra-node
 * algorithms remain in HighDensitySolver and its child solvers.
 */
export class ParallelHighDensitySolver extends HighDensitySolver {
  private readonly parallelism: number
  private readonly executor: HighDensitySolverExecutor
  private launchedParallelSolve = false
  private completedResults: HighDensityNodeSolveResult[] | null = null
  private parallelExecutionError: Error | null = null
  private executorSession: HighDensitySolverExecutorSession | null = null
  private disposeRequested = false
  private executorSessionDisposed = false
  private readonly parallelInputNodes: HighDensitySolverParams["nodePortPoints"]

  constructor({
    parallelism = 1,
    executor,
    workerUrl,
    ...solverParams
  }: ParallelHighDensitySolverParams) {
    super(solverParams)
    this.parallelInputNodes = this.unsolvedNodePortPoints.slice()
    if (!Number.isInteger(parallelism) || parallelism < 1) {
      throw new Error(
        `High-density solver parallelism must be a positive integer, received ${parallelism}`,
      )
    }
    this.parallelism = parallelism
    this.executor =
      executor ?? new WebWorkerHighDensitySolverExecutor(workerUrl)
    this.pendingEffects = []
  }

  override getSolverName(): string {
    return this.parallelism > 1
      ? "ParallelHighDensitySolver"
      : super.getSolverName()
  }

  override _step(): void {
    if (this.parallelism === 1) {
      super._step()
      return
    }

    if (this.parallelExecutionError) {
      throw this.parallelExecutionError
    }

    if (this.completedResults) {
      this.commitResults(this.completedResults)
      return
    }

    if (!this.launchedParallelSolve) {
      this.launchParallelSolve()
    }
  }

  async stepAsync(): Promise<void> {
    await stepSolverAsync(this)
  }

  async solveAsync(): Promise<void> {
    await solveSolverAsync(this)
  }

  override solve(): void {
    if (this.parallelism > 1) {
      throw new Error(
        "ParallelHighDensitySolver requires async execution. Use solveAsync() or stepAsync().",
      )
    }
    super.solve()
  }

  async dispose(): Promise<void> {
    this.disposeRequested = true
    if (this.executorSession) {
      await this.disposeExecutorSession(this.executorSession)
    }
  }

  private launchParallelSolve(): void {
    this.launchedParallelSolve = true
    const tasks = this.createTasksInSequentialOrder()
    if (tasks.length === 0) {
      this.solved = true
      return
    }

    const pendingEffect: PendingEffect = {
      name: `high-density-parallel:${tasks.length}`,
      promise: Promise.resolve(),
    }
    pendingEffect.promise = this.executeTasks(tasks)
      .then((results) => {
        this.completedResults = results
      })
      .catch((error: unknown) => {
        this.parallelExecutionError = this.toError(error)
      })
      .finally(() => {
        this.pendingEffects = this.pendingEffects?.filter(
          (effect) => effect !== pendingEffect,
        )
      })
    this.pendingEffects = [pendingEffect]
  }

  private createTasksInSequentialOrder(): HighDensityNodeSolveTask[] {
    const tasks = this.unsolvedNodePortPoints.map((node, nodeIndex) => ({
      nodeIndex,
      nodeWithPortPoints: structuredClone(node),
      nodePf: this.nodePfById.get(node.capacityMeshNodeId) ?? null,
    }))

    // HighDensitySolver historically consumes nodes with pop(). Keep that
    // result order stable even when workers finish in a different order.
    tasks.reverse()
    this.unsolvedNodePortPoints.length = 0
    return tasks
  }

  private createExecutionContext(): HighDensitySolverExecutionContext {
    return {
      colorMap: structuredClone(this.colorMap),
      connectivityNetMap: this.connMap
        ? structuredClone(this.connMap.netMap)
        : undefined,
      viaDiameter: this.viaDiameter,
      traceWidth: this.traceWidth,
      obstacleMargin: this.obstacleMargin,
      effort: this.effort,
      obstacles: structuredClone(this.obstacles),
      layerCount: this.layerCount,
      useGrowShrinkHighDensityIntraNodeSolver:
        this.useGrowShrinkHighDensityIntraNodeSolver,
      preserveTerminalPcbPortIds: this.preserveTerminalPcbPortIds,
      growShrinkMaxInnerIterationsPerGrowthAttempt:
        this.growShrinkMaxInnerIterationsPerGrowthAttempt,
      growShrinkFallbackToInvalidGeometryOnFailure:
        this.growShrinkFallbackToInvalidGeometryOnFailure,
      captureSearchDebug: this.captureSearchDebug,
    }
  }

  private async executeTasks(
    tasks: HighDensityNodeSolveTask[],
  ): Promise<HighDensityNodeSolveResult[]> {
    const activeParallelism = Math.min(this.parallelism, tasks.length)
    const session = this.executor.createSession(this.createExecutionContext(), {
      parallelism: activeParallelism,
    })
    this.executorSession = session

    try {
      if (this.disposeRequested) {
        throw new Error(
          "ParallelHighDensitySolver was disposed before its executor session became ready",
        )
      }
      return await executeTasksWithConcurrency(
        tasks,
        activeParallelism,
        async (task) => {
          const result = await session.execute(task)
          if (result.nodeIndex !== task.nodeIndex) {
            throw new Error(
              `High-density executor returned node index ${result.nodeIndex} for task ${task.nodeIndex}`,
            )
          }
          return result
        },
      )
    } finally {
      await this.disposeExecutorSession(session)
    }
  }

  private async disposeExecutorSession(
    session: HighDensitySolverExecutorSession,
  ): Promise<void> {
    if (this.executorSessionDisposed) return
    this.executorSessionDisposed = true
    if (this.executorSession === session) {
      this.executorSession = null
    }
    await session.dispose()
  }

  private commitResults(results: HighDensityNodeSolveResult[]): void {
    const solverNodeCount: Record<string, number> = {}
    const difficultNodePfs: Record<string, number[]> = {}
    const failedResults: Array<{
      nodeId: string
      error?: string
    }> = []

    this.routes = []
    this.nodeSolveMetadataById.clear()
    this.stats.highDensityResizeCount = 0
    this.stats.intraNodeCacheHits = 0
    this.stats.intraNodeCacheMisses = 0

    for (const result of results) {
      const node = this.getInputNodeForResult(result.nodeIndex)
      const nodePf = this.nodePfById.get(node.capacityMeshNodeId) ?? null
      this.nodeSolveMetadataById.set(node.capacityMeshNodeId, {
        node,
        status: result.status,
        solverType: result.solverType,
        iterations: result.iterations,
        routeCount: result.routeCount,
        nodePf,
        error: result.error,
      })
      this.stats.highDensityResizeCount += result.growthAttempts
      this.stats.intraNodeCacheHits += result.cacheHits
      this.stats.intraNodeCacheMisses += result.cacheMisses

      if (result.status === "failed") {
        this.failedSolvers.push(
          new FailedHighDensityNodeSolver({
            nodeWithPortPoints: node,
            solvedRoutes: result.routes,
            solverType: result.solverType,
            iterations: result.iterations,
            error: result.error,
          }),
        )
        failedResults.push({
          nodeId: node.capacityMeshNodeId,
          error: result.error,
        })
        continue
      }

      this.routes.push(...result.routes)
      solverNodeCount[result.solverType] =
        (solverNodeCount[result.solverType] ?? 0) + 1
      if (nodePf !== null && nodePf > 0.05) {
        difficultNodePfs[result.solverType] ??= []
        difficultNodePfs[result.solverType]!.push(nodePf)
      }
    }

    this.stats.solverNodeCount = solverNodeCount
    this.stats.difficultNodePfs = difficultNodePfs
    this.stats.parallelism = Math.min(this.parallelism, results.length)
    this.stats.parallelNodeCount = results.length

    if (failedResults.length > 0) {
      this.failed = true
      const failedNodeIds = failedResults
        .slice(0, 5)
        .map((result) => result.nodeId)
      this.error = `Failed to solve ${failedResults.length} nodes, ${failedNodeIds}. err0: ${failedResults[0]?.error}.`
      return
    }

    this.solved = true
  }

  private getInputNodeForResult(
    nodeIndex: number,
  ): HighDensitySolverParams["nodePortPoints"][number] {
    const taskNode = this.parallelInputNodes[nodeIndex]
    if (!taskNode) {
      throw new Error(
        `High-density executor returned unknown node index ${nodeIndex}`,
      )
    }
    return taskNode
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error))
  }
}
