import { SolverRuntime } from "@tscircuit/solver-utils"
import {
  NegotiateTraceClearanceSolver,
  PairedClearancePathSolver,
  type ExtractedRepairRegion,
  type NegotiatedClearanceResult,
} from "@tscircuit/repair04"
import { BaseSolver } from "lib/solvers/BaseSolver"

export type Pipeline9ParallelRegionalTaskInput = {
  region: ExtractedRepairRegion
  dirtyRouteIndices: number[]
  maxPathSearchCalls: number
  maxPathSearchNodes: number
  maxPathSearchNodesPerCall: number
  pathHeuristicWeight?: number
  pathGridSizeScale?: number
  searchDirectionCount: 1 | 2
  maxLogicalIterations: number
  traceClearance: number
  viaClearance: number
  viaHoleDiameter?: number
}

export type Pipeline9ParallelRegionalTaskOutput = {
  region: ExtractedRepairRegion
  result?: NegotiatedClearanceResult
  pathSearchNodes: number
  pathSearchCalls: number
  iterations: number
}

/** Negotiate one region from a shared immutable board snapshot. */
export class Pipeline9ParallelRegionalTaskSolver extends BaseSolver {
  static readonly solverName = "Pipeline9ParallelRegionalTaskSolver"
  private output?: Pipeline9ParallelRegionalTaskOutput

  constructor(private readonly input: Pipeline9ParallelRegionalTaskInput) {
    super()
  }

  override _step(): void {
    const { region, maxLogicalIterations, ...input } = this.input
    const solver = new NegotiateTraceClearanceSolver({
      ...input,
      srj: region.srj,
      routes: region.routes,
      bounds: region.mutableBounds,
      isLocked: (routeIndex, pointIndex): boolean =>
        region.lockedPointIndices[routeIndex]![pointIndex]!,
      allowLayerChanges: true,
    })
    while (!solver.solved && !solver.failed && solver.iterations < maxLogicalIterations) {
      solver.step()
    }
    if (solver.failed) {
      throw new Error(`Parallel regional negotiation failed: ${solver.error}`)
    }
    const result = solver.solved ? solver.getOutput() : undefined
    const activeCalls = solver.activeSubSolver instanceof PairedClearancePathSolver
      ? solver.activeSubSolver.getLaneStats().length
      : solver.activeSubSolver ? 1 : 0
    this.output = {
      region,
      result,
      pathSearchNodes: result?.pathSearchNodes ?? solver.stats.pathSearchNodes,
      pathSearchCalls: result?.pathSearchCalls ?? solver.stats.pathSearchCalls + activeCalls,
      iterations: solver.iterations,
    }
    this.solved = true
  }

  getOutput(): Pipeline9ParallelRegionalTaskOutput {
    if (!this.output) throw new Error("Parallel regional negotiation is not complete")
    return this.output
  }
}

SolverRuntime.registerSolver(Pipeline9ParallelRegionalTaskSolver)
