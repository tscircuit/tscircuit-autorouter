import type { HdRoute as RepairHdRoute } from "high-density-repair02"
import { Pipeline4HighDensityRepairSolver } from "../../solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type { HighDensityRoute } from "../../types/high-density-types"
import type { ParallelStageWorkerPool, ParallelStageWorkerResult } from "./parallelStageWorkerTypes"

type Params = ConstructorParameters<typeof Pipeline4HighDensityRepairSolver>[0] & {
  workerPool: ParallelStageWorkerPool
}

function restoreRouteMetadata(
  route: RepairHdRoute,
  original: HighDensityRoute,
): HighDensityRoute {
  return {
    connectionName: route.connectionName ?? original.connectionName,
    rootConnectionName: original.rootConnectionName,
    ...(original.startPcbPortId ? { startPcbPortId: original.startPcbPortId } : {}),
    ...(original.endPcbPortId ? { endPcbPortId: original.endPcbPortId } : {}),
    regionId: route.capacityMeshNodeId ?? original.regionId,
    traceThickness: original.traceThickness,
    viaDiameter: route.viaDiameter ?? original.viaDiameter,
    route: route.route?.map((point) => ({ x: point.x, y: point.y, z: point.z ?? 0 })) ?? original.route,
    vias: route.vias?.map((via) => ({ x: via.x, y: via.y })) ?? original.vias,
    jumpers: original.jumpers,
  }
}

/** The serial stage already snapshots fixed neighbors before repairing any node. */
export class ParallelHighDensityRepairSolver extends Pipeline4HighDensityRepairSolver {
  readonly workerPool: ParallelStageWorkerPool
  private launched = false

  constructor({ workerPool, ...params }: Params) {
    super(params)
    this.workerPool = workerPool
    this.pendingEffects = []
  }

  override getSolverName(): string {
    return "ParallelHighDensityRepairSolver"
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
          kind: "repairNode",
          sample: entry.sample,
          margin: this.repairMargin,
        }).then((result) => ({ entryIndex, result })),
      ),
    ).then((results) => {
      const clearanceStats = {
        nodeClearanceInitialConflictCount: 0,
        nodeClearanceFinalConflictCount: 0,
        nodeClearanceCandidateCount: 0,
      }
      results.sort((left, right) => left.entryIndex - right.entryIndex)
      for (const { entryIndex, result } of results) {
        const entry = this.sampleEntries[entryIndex]
        if (result.kind !== "repairNode") {
          throw new Error(`Invalid repair worker output for node ${entry.node.capacityMeshNodeId}`)
        }
        for (const key of Object.keys(clearanceStats) as (keyof typeof clearanceStats)[]) {
          clearanceStats[key] += Number(result.stats[key] ?? 0)
        }
        for (let routeIndex = 0; routeIndex < entry.routeIndexes.length; routeIndex++) {
          const index = entry.routeIndexes[routeIndex]
          const original = this.originalHdRoutes[index]
          const repairedRoute = result.repairedRoutes[routeIndex]
          this.repairedRoutesByIndex.set(index, repairedRoute ? restoreRouteMetadata(repairedRoute, original) : original)
        }
      }
      this.activeSampleIndex = this.sampleEntries.length
      this.stats = {
        ...clearanceStats,
        sampleCount: this.sampleEntries.length,
        repairedNodeCount: this.activeSampleIndex,
        repairedRouteCount: this.repairedRoutesByIndex.size,
      }
      this.solved = true
      this.pendingEffects = []
    }).catch((error: unknown) => {
      this.failed = true
      this.error = String(error)
      throw error
    })
    this.pendingEffects = [{ name: "parallel-high-density-repair", promise }]
  }

  override solve(): void {
    throw new Error("Parallel high density repair requires solveAsync() or awaiting pendingEffects")
  }

  async solveAsync(): Promise<void> {
    this.step()
    await Promise.all(this.pendingEffects!.map((effect) => effect.promise))
  }
}
