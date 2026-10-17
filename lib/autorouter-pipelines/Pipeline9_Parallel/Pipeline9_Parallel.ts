import type { SimpleRouteJson } from "../../types/srj-types"
import { SolverRuntime } from "../../solver-runtime/SolverRuntime"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph, type AutoroutingPipelineSolverOptions } from "../AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9ParallelHighDensitySolver } from "./Pipeline9ParallelHighDensitySolver"

export type Pipeline9ParallelOptions = AutoroutingPipelineSolverOptions & { runtime?: SolverRuntime }

/** Pipeline9 with deterministic, synchronous high-density batches. Runtime ownership stays with the caller. */
export class Pipeline9_Parallel extends AutoroutingPipelineSolver9_PreloadedTraceGraph {
  readonly runtime: SolverRuntime

  constructor(srj: SimpleRouteJson, options: Pipeline9ParallelOptions = {}) {
    super(srj, options)
    this.runtime = options.runtime ?? SolverRuntime.defaultRuntime
    const index = this.pipelineDef.findIndex((step) => step.solverName === "highDensityRouteSolver")
    const original = this.pipelineDef[index]
    if (!original) throw new Error("Pipeline9 high-density phase is missing")
    this.pipelineDef[index] = {
      ...original,
      solverClass: Pipeline9ParallelHighDensitySolver as any,
      getConstructorParams: (solver: Pipeline9_Parallel) => {
        const [params] = original.getConstructorParams(solver)
        return [{ ...params, runtime: solver.runtime }]
      },
    } as any
  }
}
