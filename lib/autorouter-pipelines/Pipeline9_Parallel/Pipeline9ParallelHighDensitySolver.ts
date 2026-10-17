import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { ParallelSolver } from "../../solvers/ParallelSolver/ParallelSolver"
import type { ParallelTaskBatch } from "../../solver-runtime/ParallelTaskBatch"
import type { SolverRuntime } from "../../solver-runtime/SolverRuntime"
import type { NodeWithPortPoints } from "../../types/high-density-types"
import { runPipeline9HighDensityTask, type HighDensityTaskOutput, type HighDensityTaskShared } from "./pipeline9HighDensityTask"

// Batch boundaries depend on input order, never on worker count or completion time.
const NODES_PER_STEP = 256
const NODES_PER_JOB = 8

class HighDensityNodeBatch extends ParallelSolver<NodeWithPortPoints[], HighDensityTaskOutput, HighDensityTaskShared> {
  constructor(private readonly owner: Pipeline9ParallelHighDensitySolver, private readonly shared: HighDensityTaskShared, runtime: SolverRuntime) {
    super({ runtime })
    this.MAX_ITERATIONS = Number.MAX_SAFE_INTEGER
  }

  protected getNextBatch(): ParallelTaskBatch<NodeWithPortPoints[], HighDensityTaskOutput, HighDensityTaskShared> | null {
    const remaining = this.owner.unsolvedNodePortPoints
    if (remaining.length === 0) return null
    const nodes = remaining.slice(-NODES_PER_STEP).reverse()
    const inputs: NodeWithPortPoints[][] = []
    for (let offset = 0; offset < nodes.length; offset += NODES_PER_JOB) {
      inputs.push(nodes.slice(offset, offset + NODES_PER_JOB).reverse())
    }
    return {
      inputs,
      shared: this.shared,
      runTask: runPipeline9HighDensityTask,
      worker: {
        moduleUrl: new URL(import.meta.url.endsWith(".ts") ? "./pipeline9HighDensityTask.ts" : "./parallel-worker/pipeline9HighDensityTask.js", import.meta.url).href,
        exportName: "runPipeline9HighDensityTask",
      },
    }
  }

  protected commitBatch(outputs: readonly HighDensityTaskOutput[]): boolean {
    const logicalIterations = this.owner.logicalIterations + outputs.reduce((sum, output) => sum + output.iterations - 1, 0)
    if (logicalIterations > this.owner.MAX_ITERATIONS + 1) throw new Error("Parallel high-density routing exceeded its logical iteration budget")
    for (const output of outputs) {
      this.owner.routes.push(...output.routes)
      this.owner.unsolvedNodePortPoints.splice(-output.nodeCount)
      this.owner.logicalIterations += output.iterations - 1
      for (const [key, value] of Object.entries(output.stats)) {
        if (key !== "nodeCount" && key !== "fixedObstacleCount") this.owner.stats[key] += value
      }
    }
    return this.owner.unsolvedNodePortPoints.length === 0
  }
}

/** Parallelizes independent nodes; preloaded copper retains its ordered mutation semantics. */
export class Pipeline9ParallelHighDensitySolver extends Pipeline9HighDensitySolver {
  private readonly batchSolver: HighDensityNodeBatch
  logicalIterations = 1

  constructor(params: Pipeline9HighDensitySolverParams & { runtime: SolverRuntime }) {
    super(params)
    const { connMap, nodePortPoints: _, runtime, ...shared } = params
    this.batchSolver = new HighDensityNodeBatch(this, { ...shared, connectivityNetMap: connMap.netMap }, runtime)
  }

  override _step(): void {
    // Fixed-route repairs can change the obstacles seen by subsequent nodes.
    if (this.fixedHdRoutes.length > 0) {
      super._step()
      return
    }
    this.batchSolver.step()
    this.solved = this.batchSolver.solved
    this.failed = this.batchSolver.failed
    this.error = this.batchSolver.error
  }
}
