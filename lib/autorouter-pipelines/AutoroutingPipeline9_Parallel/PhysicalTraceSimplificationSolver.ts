import { TraceSimplificationSolver, UselessViaRemovalSolver, MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import type { HighDensityRoute } from "../../types/high-density-types"
import type { Obstacle } from "../../types"
import { getPhysicalCopperObstacleZLayers, markPhysicalCopperTransitions } from "./markPhysicalCopperTransitions"
import { useOptimizedViaRemovalSpatialIndex } from "./useOptimizedViaRemovalSpatialIndex"
import { preserveLeadingPathLayerTransitions } from "./preserveLeadingPathLayerTransitions"
import { markNativeThroughObstacleSegments } from "./markNativeThroughObstacleSegments"

export type PhysicalSimplificationParams = ConstructorParameters<typeof TraceSimplificationSolver>[0] & {
  requirePhysicalCopperTransitions?: boolean
}

/** Keeps a real via when a rectangular routing approximation cannot prove copper contact. */
export class PhysicalTraceSimplificationSolver extends TraceSimplificationSolver {
  private readonly immutableHdRoutes: ReadonlyArray<HighDensityRoute>
  private readonly indexedViaRemovalSolvers = new WeakSet<UselessViaRemovalSolver>()

  constructor(params: PhysicalSimplificationParams) {
    // The pinned base normalizer ignores public zLayers and widens empty spans.
    // Retain the physical input separately before its constructor calls this hook.
    const config = { ...params, originalPhysicalCopperObstacles: params.obstacles,
      obstacles: params.requirePhysicalCopperTransitions ? params.obstacles.map((obstacle) => ({
        ...obstacle, __zLayers: getPhysicalCopperObstacleZLayers(obstacle, params.layerCount),
      })) : params.obstacles,
    }
    super(config)
    this.immutableHdRoutes = params.otherHdRoutes ?? []
  }

  protected get requiresPhysicalCopperTransitions(): boolean {
    return (this as unknown as { simplificationConfig: PhysicalSimplificationParams }).simplificationConfig.requirePhysicalCopperTransitions === true
  }

  protected prepareSimplificationChild(): void {
    const solver = this.activeSubSolver
    if (solver instanceof UselessViaRemovalSolver && !this.indexedViaRemovalSolvers.has(solver)) {
      useOptimizedViaRemovalSpatialIndex(solver, this.immutableHdRoutes)
      this.indexedViaRemovalSolvers.add(solver)
    }
    if (this.requiresPhysicalCopperTransitions && solver instanceof MultiSimplifiedPathSolver) {
      preserveLeadingPathLayerTransitions(solver)
    }
  }

  override _step(): void {
    // Install after native child construction and before its first route step.
    // This also precedes the parallel wrapper's synchronous child drain.
    this.prepareSimplificationChild()
    super._step()
    this.prepareSimplificationChild()
  }

  override markThroughObstacleSegments(routes: readonly HighDensityRoute[]): HighDensityRoute[] {
    // The pinned base constructor sets this config before calling this virtual method.
    const config = (this as unknown as { simplificationConfig: PhysicalSimplificationParams & {
      originalPhysicalCopperObstacles?: readonly Obstacle[]
    } }).simplificationConfig
    if (!config.requirePhysicalCopperTransitions) {
      return markNativeThroughObstacleSegments({ routes, obstacles: config.obstacles, connMap: config.connMap })
    }
    return markPhysicalCopperTransitions(routes, { ...config,
      obstacles: config.originalPhysicalCopperObstacles ?? config.obstacles })
  }
}
