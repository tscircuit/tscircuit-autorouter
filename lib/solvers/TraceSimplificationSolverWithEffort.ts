import {
  TraceSimplificationSolver,
  type TraceSimplificationSolverOptions,
} from "@tscircuit/trace-simplification-solver"

export class TraceSimplificationSolverWithEffort extends TraceSimplificationSolver {
  constructor({
    effort,
    ...options
  }: TraceSimplificationSolverOptions & { effort: number }) {
    super(options)
    this.MAX_SIMPLIFICATION_PIPELINE_LOOPS = Math.ceil(
      this.MAX_SIMPLIFICATION_PIPELINE_LOOPS * effort,
    )
  }
}
