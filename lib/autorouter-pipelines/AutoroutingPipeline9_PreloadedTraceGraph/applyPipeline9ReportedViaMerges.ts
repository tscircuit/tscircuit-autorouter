import {
  Pipeline9ReportedViaMergeSolver,
  type Pipeline9ReportedViaMergeParams,
  type Pipeline9ReportedViaMergesResult,
} from "./Pipeline9ReportedViaMergeSolver"

export type { Pipeline9ReportedViaMergesResult } from "./Pipeline9ReportedViaMergeSolver"

/** Synchronous compatibility entry point; pipeline stages step the solver directly. */
export const applyPipeline9ReportedViaMerges = (
  params: Pipeline9ReportedViaMergeParams,
): Pipeline9ReportedViaMergesResult => {
  const solver = new Pipeline9ReportedViaMergeSolver(params)
  while (!solver.solved && !solver.failed) solver.step()
  return solver.getResult()
}
