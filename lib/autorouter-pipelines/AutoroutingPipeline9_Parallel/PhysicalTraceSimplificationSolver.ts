import { TraceSimplificationSolver } from "@tscircuit/trace-simplification-solver"
import type { HighDensityRoute } from "../../types/high-density-types"
import type { Obstacle } from "../../types"
import { getPhysicalCopperObstacleZLayers, markPhysicalCopperTransitions } from "./markPhysicalCopperTransitions"

export type PhysicalSimplificationParams = ConstructorParameters<typeof TraceSimplificationSolver>[0] & {
  requirePhysicalCopperTransitions?: boolean
}

/** Keeps a real via when a rectangular routing approximation cannot prove copper contact. */
export class PhysicalTraceSimplificationSolver extends TraceSimplificationSolver {
  constructor(params: PhysicalSimplificationParams) {
    // The pinned base normalizer ignores public zLayers and widens empty spans.
    // Retain the physical input separately before its constructor calls this hook.
    const config = { ...params, originalPhysicalCopperObstacles: params.obstacles,
      obstacles: params.requirePhysicalCopperTransitions ? params.obstacles.map((obstacle) => ({
        ...obstacle, __zLayers: getPhysicalCopperObstacleZLayers(obstacle, params.layerCount),
      })) : params.obstacles,
    }
    super(config)
  }

  override markThroughObstacleSegments(routes: readonly HighDensityRoute[]): HighDensityRoute[] {
    // The pinned base constructor sets this config before calling this virtual method.
    const config = (this as unknown as { simplificationConfig: PhysicalSimplificationParams & {
      originalPhysicalCopperObstacles?: readonly Obstacle[]
    } }).simplificationConfig
    if (!config.requirePhysicalCopperTransitions) return super.markThroughObstacleSegments(routes)
    return markPhysicalCopperTransitions(routes, { ...config,
      obstacles: config.originalPhysicalCopperObstacles ?? config.obstacles })
  }
}
