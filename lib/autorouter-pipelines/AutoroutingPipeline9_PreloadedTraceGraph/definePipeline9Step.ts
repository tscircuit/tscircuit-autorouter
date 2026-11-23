import type { BaseSolver } from "../../solvers/BaseSolver"
import type { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "./AutoroutingPipelineSolver9_PreloadedTraceGraph"

type SolverClass = new (...args: never[]) => BaseSolver

export type Pipeline9Step<T extends SolverClass> = {
  solverName: string
  solverClass: T
  getConstructorParams: (
    pipeline: AutoroutingPipelineSolver9_PreloadedTraceGraph,
  ) => ConstructorParameters<T>
  onSolved?: (pipeline: AutoroutingPipelineSolver9_PreloadedTraceGraph) => void
}

/** Type-check each stage’s constructor arguments before it enters the pipeline. */
export function definePipeline9Step<
  T extends SolverClass,
  const Args extends ConstructorParameters<T>,
>({
  solverName,
  solverClass,
  getConstructorParams,
  onSolved,
}: {
  solverName: keyof AutoroutingPipelineSolver9_PreloadedTraceGraph
  solverClass: T
  getConstructorParams: (
    pipeline: AutoroutingPipelineSolver9_PreloadedTraceGraph,
  ) => Args
  onSolved?: Pipeline9Step<T>["onSolved"]
}): Pipeline9Step<T> {
  return { solverName, solverClass, getConstructorParams, onSolved }
}
