import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import type { PendingEffect } from "../../solvers/BaseSolver"
import type { ParallelStageWorkerPool, ParallelStageWorkerResult } from "./parallelStageWorkerTypes"

type Params = ConstructorParameters<typeof HighDensityForceImproveSolver>[0] & {
  workerPool: ParallelStageWorkerPool
}

/** Preserve the serial solver's node ownership and commit in its original order. */
export class ParallelHighDensityForceImproveSolver extends HighDensityForceImproveSolver {
  readonly workerPool: ParallelStageWorkerPool
  pendingEffects: PendingEffect[] = []
  private launched = false

  constructor({ workerPool, ...params }: Params) {
    super(params)
    this.workerPool = workerPool
  }

  override getSolverName(): string {
    return "ParallelHighDensityForceImproveSolver"
  }

  override _step(): void {
    if (this.launched) return
    this.launched = true
    const orderedEntries = this.sampleEntries.map((entry, entryIndex) => ({
      entry,
      entryIndex,
      weight: entry.routeIndexes.reduce((total, index) => total + this.originalHdRoutes[index].route.length, 0) * entry.routeIndexes.length,
    })).sort((left, right) => right.weight - left.weight || left.entryIndex - right.entryIndex)
    const promise = Promise.all(
      orderedEntries.map(({ entry, entryIndex }) =>
        this.workerPool.run<ParallelStageWorkerResult>({
          kind: "forceImproveNode",
          nodeWithPortPoints: entry.node,
          hdRoutes: entry.routeIndexes.map((index) => this.originalHdRoutes[index]),
          totalStepsPerNode: this.totalStepsPerNode,
          nodeAssignmentMargin: this.nodeAssignmentMargin,
        }).then((result) => ({ entryIndex, result })),
      ),
    ).then((results) => {
      results.sort((left, right) => left.entryIndex - right.entryIndex)
      for (const { entryIndex, result } of results) {
        const entry = this.sampleEntries[entryIndex]
        if (result.kind !== "forceImproveNode" || result.routes.length !== entry.routeIndexes.length) {
          throw new Error(`Invalid force improvement worker output for node ${entry.node.capacityMeshNodeId}`)
        }
        for (let routeIndex = 0; routeIndex < entry.routeIndexes.length; routeIndex++) {
          this.improvedRoutesByIndex.set(entry.routeIndexes[routeIndex], result.routes[routeIndex])
        }
      }
      this.activeSampleIndex = this.sampleEntries.length
      this.stats = {
        ...this.stats,
        improvedNodeCount: this.activeSampleIndex,
        improvedRouteCount: this.improvedRoutesByIndex.size,
      }
      this.solved = true
      this.pendingEffects = []
    }).catch((error: unknown) => {
      this.failed = true
      this.error = String(error)
      throw error
    })
    this.pendingEffects = [{ name: "parallel-force-improvement", promise }]
  }

  override solve(): void {
    throw new Error("Parallel force improvement requires solveAsync() or awaiting pendingEffects")
  }

  async solveAsync(): Promise<void> {
    this.step()
    await Promise.all(this.pendingEffects.map((effect) => effect.promise))
  }
}
