import { TraceSimplificationSolver } from "../TraceSimplificationSolver/TraceSimplificationSolver"

type TraceSimplificationConfig = ConstructorParameters<
  typeof TraceSimplificationSolver
>[0]

export class PostDrcTraceSimplificationSolver extends TraceSimplificationSolver {
  constructor(config: TraceSimplificationConfig) {
    super(config)
    if ((config.effort ?? 1) > 1) return

    this.hdRoutes = config.hdRoutes.map((route) => structuredClone(route))
    this.SIMPLIFICATION_STRATEGY_LIMIT = 0
    this.stats = {
      postDrcSimplificationEffortBudget: 0,
      postDrcSimplificationStoppedAtBaselineEffort: true,
      simplificationPipelineLoops: 0,
      simplificationStrategyLimit: 0,
    }
    this.progress = 1
    this.solved = true
  }

  override getSolverName(): string {
    return "PostDrcTraceSimplificationSolver"
  }
}
