import { Pipeline9EffortCleanupSolver } from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9EffortCleanupSolver"
import { PhysicalTraceSimplificationSolver, type PhysicalSimplificationParams } from "./PhysicalTraceSimplificationSolver"
import { markPhysicalCopperTransitions } from "./markPhysicalCopperTransitions"

export class PhysicalEffortCleanupSolver extends Pipeline9EffortCleanupSolver {
  constructor(params: ConstructorParameters<typeof Pipeline9EffortCleanupSolver>[0]) {
    const hdRoutes = markPhysicalCopperTransitions(params.config.hdRoutes, params.config)
    super({ ...params, config: { ...params.config, hdRoutes } })
  }

  protected override createSimplifier(config: PhysicalSimplificationParams): PhysicalTraceSimplificationSolver {
    return new PhysicalTraceSimplificationSolver({ ...config, requirePhysicalCopperTransitions: true })
  }
}
