import { SolverRuntime } from "@tscircuit/solver-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { BaseSolver } from "../../solvers/BaseSolver"
import {
  Pipeline9HighDensitySolver,
  type Pipeline9HighDensitySolverParams,
} from "./Pipeline9HighDensitySolver"
import type { HighDensityIntraNodeRoute } from "../../types/high-density-types"

export type Pipeline9HighDensityBatchInput = Omit<
  Pipeline9HighDensitySolverParams,
  "connMap"
> & {
  connectivityNetMap: Record<string, string[]>
  maxIterations: number
  sharedNodeCursor?: Int32Array
}

export type Pipeline9HighDensityNodeOutput = {
  routes: HighDensityIntraNodeRoute[]
  sourceNodeIndex?: number
  stats: Record<string, number>
  benchmarkDiagnosticCounters: Record<string, number>
  iterations: number
  consumedNodeCount: number
  solved: boolean
  error: string | null
}

export type Pipeline9HighDensityBatchOutput = Pipeline9HighDensityNodeOutput[]

/** Evaluate an independent serial batch; the parent owns ordered outcome acceptance. */
export class Pipeline9HighDensityBatchSolver extends BaseSolver {
  static readonly solverName: string = "Pipeline9HighDensityBatchSolver"
  private output?: Pipeline9HighDensityBatchOutput

  constructor(private readonly input: Pipeline9HighDensityBatchInput) {
    super()
  }

  override _step(): void {
    if (this.input.fixedHdRoutes.length !== 0) {
      throw new Error(
        "Parallel high-density batches cannot mutate preloaded copper",
      )
    }
    const connMap = new ConnectivityMap(this.input.connectivityNetMap)
    this.output = []
    let sequentialIndex = 0
    const nextIndex = (): number => this.input.sharedNodeCursor
      ? Atomics.add(this.input.sharedNodeCursor, 0, 1)
      : sequentialIndex++
    for (let nodeIndex = nextIndex(); nodeIndex < this.input.nodePortPoints.length; nodeIndex = nextIndex()) {
      const node = this.input.nodePortPoints[nodeIndex]!
      // Only this node is routed by the child. Avoid copying the board-wide
      // priority map twice for every claimed node.
      const nodePf = this.input.nodePfById instanceof Map
        ? this.input.nodePfById.get(node.capacityMeshNodeId)
        : this.input.nodePfById?.[node.capacityMeshNodeId]
      const solver = new Pipeline9HighDensitySolver({
        ...this.input,
        nodePortPoints: [node],
        nodePfById: new Map([[node.capacityMeshNodeId, nodePf ?? null]]),
        connMap,
      })
      solver.MAX_ITERATIONS = this.input.maxIterations
      solver.solve()
      // Every node has an independent outcome. In particular, a failed node
      // must not skip another node that precedes it in the parent's order.
      this.output.push({
        sourceNodeIndex: this.input.sharedNodeCursor ? nodeIndex : undefined,
        routes: solver.routes,
        stats: solver.stats,
        benchmarkDiagnosticCounters: solver.benchmarkDiagnosticCounters,
        iterations: solver.iterations,
        consumedNodeCount: 1 - solver.unsolvedNodePortPoints.length,
        solved: solver.solved,
        error: solver.error,
      })
    }
    this.solved = true
  }

  getOutput(): Pipeline9HighDensityBatchOutput {
    if (!this.output) {
      throw new Error("High-density batch has not completed")
    }
    return this.output
  }
}

SolverRuntime.registerSolver(Pipeline9HighDensityBatchSolver)
