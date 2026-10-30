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
  deferPreloadedMutations?: boolean
  maxIterations: number
  sharedNodeCursor?: Int32Array
}

export type Pipeline9HighDensityNodeOutput = {
  routes: HighDensityIntraNodeRoute[]
  preloadedMutationDeferred: boolean
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
    const connMap = new ConnectivityMap(this.input.connectivityNetMap)
    this.output = []
    let sequentialIndex = 0
    const nextIndex = (): number => this.input.sharedNodeCursor
      ? Atomics.add(this.input.sharedNodeCursor, 0, 1)
      : sequentialIndex++
    for (let nodeIndex = nextIndex(); nodeIndex < this.input.nodePortPoints.length; nodeIndex = nextIndex()) {
      const node = this.input.nodePortPoints[nodeIndex]!
      const solver = new Pipeline9HighDensitySolver({
        ...this.input,
        nodePortPoints: [node],
        connMap,
      })
      solver.MAX_ITERATIONS = this.input.maxIterations
      solver.deferPreloadedMutations = this.input.deferPreloadedMutations === true
      while (!solver.solved && !solver.failed && !solver.preloadedMutationDeferred) {
        solver.step()
      }
      if (solver.fixedRouteReplacements.size || solver.removedFixedRouteConnectionNames.size) {
        throw new Error("A parallel node mutated shared preloaded copper")
      }
      // Every node has an independent outcome. In particular, a failed node
      // must not skip another node that precedes it in the parent's order.
      this.output.push({
        preloadedMutationDeferred: solver.preloadedMutationDeferred,
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
