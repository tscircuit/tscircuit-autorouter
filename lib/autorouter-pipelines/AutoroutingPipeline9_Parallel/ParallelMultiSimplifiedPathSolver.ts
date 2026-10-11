import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import type { ParallelStageWorkerPool, ParallelStageWorkerResult } from "./parallelStageWorkerTypes"
import { getParallelPathBatches } from "./getParallelPathBatches"

type Params = ConstructorParameters<typeof MultiSimplifiedPathSolver>[0] & {
  workerPool: ParallelStageWorkerPool
  workerCount: number
}

/** Run only geometrically independent components concurrently. */
export class ParallelMultiSimplifiedPathSolver extends MultiSimplifiedPathSolver {
  readonly workerPool: ParallelStageWorkerPool
  readonly batches: number[][]
  private launched = false

  constructor({ workerPool, workerCount, ...params }: Params) {
    super(params)
    this.workerPool = workerPool
    const groups = getParallelPathBatches(params.unsimplifiedHdRoutes, this.useTraceWidthAwareClearance, workerCount)
    this.batches = groups.batches
    this.stats = { interactionComponentCount: groups.interactionComponentCount, parallelBatchCount: this.batches.length }
    this.pendingEffects = []
  }

  override getSolverName(): string {
    return "ParallelMultiSimplifiedPathSolver"
  }

  override _step(): void {
    if (this.batches.length <= 1) {
      super._step()
      return
    }
    if (this.launched) return
    this.launched = true
    const promise = Promise.all(this.batches.map((indexes) => {
      const ownedIndexes = new Set(indexes)
      return this.workerPool.run<ParallelStageWorkerResult>({
        kind: "simplifyPathComponent",
        connectivityNetMap: this.connMap.netMap,
        connectivityIdToNetMap: this.connMap.idToNetMap,
        params: {
          unsimplifiedHdRoutes: indexes.map((index) => this.unsimplifiedHdRoutes[index]),
          otherHdRoutes: [
            ...this.otherHdRoutes,
            ...this.unsimplifiedHdRoutes.filter((_, index) => !ownedIndexes.has(index)),
          ],
          obstacles: this.obstacles,
          colorMap: this.colorMap,
          outline: this.outline,
          minBoardEdgeClearance: this.minBoardEdgeClearance,
          defaultViaDiameter: this.defaultViaDiameter,
          useTraceWidthAwareClearance: this.useTraceWidthAwareClearance,
          enableVertexShortcuts: this.enableVertexShortcuts,
        },
      })
    })).then((results) => {
      const routesByIndex = new Map<number, (typeof this.simplifiedHdRoutes)[number]>()
      for (let batchIndex = 0; batchIndex < results.length; batchIndex++) {
        const result = results[batchIndex]
        const indexes = this.batches[batchIndex]
        if (result.kind !== "simplifyPathComponent" || result.routes.length !== indexes.length) {
          throw new Error(`Invalid parallel path simplification output for batch ${batchIndex}`)
        }
        for (let index = 0; index < indexes.length; index++) routesByIndex.set(indexes[index], result.routes[index])
      }
      this.simplifiedHdRoutes = this.unsimplifiedHdRoutes.map((_, index) => {
        const route = routesByIndex.get(index)
        if (!route) throw new Error(`Parallel path simplification omitted route ${index}`)
        return route
      })
      this.currentUnsimplifiedHdRouteIndex = this.unsimplifiedHdRoutes.length
      this.solved = true
      this.pendingEffects = []
    }).catch((error: unknown) => {
      this.failed = true
      this.error = String(error)
      throw error
    })
    this.pendingEffects = [{ name: "parallel-path-simplification", promise }]
  }
}
