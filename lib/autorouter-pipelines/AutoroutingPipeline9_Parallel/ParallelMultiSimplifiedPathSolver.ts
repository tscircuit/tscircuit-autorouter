import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import type { ParallelStageWorkerPool } from "./parallelStageWorkerTypes"
import { getParallelPathBatches } from "./getParallelPathBatches"
import { preserveLeadingPathLayerTransitions } from "./preserveLeadingPathLayerTransitions"
import { getParallelPathDependencies, type ParallelPathDependencies } from "./getParallelPathDependencies"
import type { ParallelPathWaveContext, ParallelPathWaveResult } from "./parallelStageWorkerTypes"
import { takeParallelPathReadyBatch } from "./takeParallelPathReadyBatch"

type Params = ConstructorParameters<typeof MultiSimplifiedPathSolver>[0] & {
  workerPool: ParallelStageWorkerPool
  workerCount: number
  preserveLeadingLayerTransitions?: boolean
}

let customPathContextId = 0

/** Preserve ordered geometry dependencies without serializing an entire component. */
export class ParallelMultiSimplifiedPathSolver extends MultiSimplifiedPathSolver {
  readonly workerPool: ParallelStageWorkerPool
  readonly batches: number[][]
  private launched = false
  readonly preserveLeadingLayerTransitions: boolean
  readonly hasParallelWork: boolean
  readonly dependencies: ParallelPathDependencies
  private readonly workerCount: number
  private readonly contextId: number

  constructor({ workerPool, workerCount, preserveLeadingLayerTransitions, ...params }: Params) {
    super(params)
    this.workerPool = workerPool
    this.workerCount = workerCount
    this.contextId = workerPool.createContextId?.() ?? --customPathContextId
    this.preserveLeadingLayerTransitions = preserveLeadingLayerTransitions ?? false
    const groups = getParallelPathBatches(params.unsimplifiedHdRoutes, this.useTraceWidthAwareClearance, workerCount)
    this.batches = groups.batches
    this.dependencies = getParallelPathDependencies(params.unsimplifiedHdRoutes, this.useTraceWidthAwareClearance, this.connMap)
    this.hasParallelWork = workerCount > 1 && this.dependencies.maximumReadyCount > 1
    this.stats = { interactionComponentCount: groups.interactionComponentCount, parallelBatchCount: this.batches.length }
    this.pendingEffects = []
    if (this.preserveLeadingLayerTransitions) preserveLeadingPathLayerTransitions(this)
  }

  override getSolverName(): string {
    return "ParallelMultiSimplifiedPathSolver"
  }

  override solve(): void {
    if (this.hasParallelWork) throw new Error("Parallel path simplification requires awaiting pendingEffects or solveAsync()")
    super.solve()
  }

  async solveAsync(): Promise<void> {
    while (!this.solved && !this.failed) {
      this.step()
      await Promise.all(this.pendingEffects!.map((effect) => effect.promise))
    }
    if (this.failed) throw new Error(`Parallel path simplification failed: ${this.error}`)
  }

  override _step(): void {
    if (!this.hasParallelWork) {
      super._step()
      return
    }
    if (this.launched) return
    this.launched = true
    const context: ParallelPathWaveContext = {
        connectivityNetMap: this.connMap.netMap,
        connectivityIdToNetMap: this.connMap.idToNetMap,
        params: {
          unsimplifiedHdRoutes: this.unsimplifiedHdRoutes,
          otherHdRoutes: this.otherHdRoutes,
          obstacles: this.obstacles,
          colorMap: this.colorMap,
          outline: this.outline,
          minBoardEdgeClearance: this.minBoardEdgeClearance,
          defaultViaDiameter: this.defaultViaDiameter,
          useTraceWidthAwareClearance: this.useTraceWidthAwareClearance,
          enableVertexShortcuts: this.enableVertexShortcuts,
          preserveLeadingLayerTransitions: this.preserveLeadingLayerTransitions,
        },
    }
    const remaining = this.dependencies.predecessors.map((indexes) => indexes.length)
    const ready = remaining.flatMap((count, index) => count === 0 ? [index] : [])
    const routesByIndex = new Map<number, (typeof this.simplifiedHdRoutes)[number]>()
    const stepsByIndex = new Array<number>(this.unsimplifiedHdRoutes.length)
    let activeJobs = 0
    let failed = false
    const promise = new Promise<void>((resolve, reject) => {
      const dispatch = (): void => {
        while (!failed && activeJobs < this.workerCount && ready.length > 0) {
          // Heavy ready routes start first. Completion order never chooses geometry.
          ready.sort((left, right) => this.unsimplifiedHdRoutes[right]!.route.length - this.unsimplifiedHdRoutes[left]!.route.length || left - right)
          const routeIndexes = takeParallelPathReadyBatch(ready, this.unsimplifiedHdRoutes,
            this.workerCount - activeJobs)
          activeJobs++
          const updates = [...routesByIndex].sort(([left], [right]) => left - right).map(([index, route]) => ({ index, route }))
          void this.workerPool.run<ParallelPathWaveResult>({ kind: "simplifyPathWave", contextId: this.contextId,
            context, indexes: routeIndexes, updates }).then((result): void => {
            if (failed) return
            if (result.kind !== "simplifyPathWave" || result.contextId !== this.contextId || result.results.length !== routeIndexes.length) {
              throw new Error(`Invalid path simplification result for routes ${routeIndexes.join(",")}`)
            }
            for (const [position, routeIndex] of routeIndexes.entries()) {
              const output = result.results[position]!
              if (!output || output.index !== routeIndex || !output.route ||
                !Number.isSafeInteger(output.nativeSteps) || output.nativeSteps < 1) {
                throw new Error(`Invalid path simplification result for route ${routeIndex}`)
              }
            }
            activeJobs--
            // Publish the complete successful batch before releasing successors.
            for (const output of result.results) {
              routesByIndex.set(output.index, output.route)
              stepsByIndex[output.index] = output.nativeSteps
              for (const successor of this.dependencies.successors[output.index]!) {
                remaining[successor]!--
                if (remaining[successor] === 0) ready.push(successor)
              }
            }
            if (routesByIndex.size === this.unsimplifiedHdRoutes.length) resolve()
            else dispatch()
          }).catch((error: unknown): void => {
            failed = true
            reject(error)
          })
        }
      }
      dispatch()
    }).then(() => {
      let nativeSteps = 1
      for (const count of stepsByIndex) nativeSteps += count
      if (nativeSteps > this.MAX_ITERATIONS + 1) throw new Error("Parallel path simplification exceeded the native phase iteration budget")
      this.simplifiedHdRoutes = this.unsimplifiedHdRoutes.map((_, index) => {
        const route = routesByIndex.get(index)
        if (!route) throw new Error(`Parallel path simplification omitted route ${index}`)
        return route
      })
      this.currentUnsimplifiedHdRouteIndex = this.unsimplifiedHdRoutes.length
      this.stats.nativePathSteps = nativeSteps
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
