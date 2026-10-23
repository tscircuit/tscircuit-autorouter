import type { ClearancePathSearchStats } from "@tscircuit/repair04"
import type { RepairRoutePoint } from "./repairRegionTypes"

export type ClearanceSearchTask = {
  identity: string
  context: string
  dependencies: string
  maxNodes: number
  layerCount: number
}

export type CompletedClearanceSearchTask = {
  path: RepairRoutePoint[] | null
  stats: ClearancePathSearchStats
}

export type ClearanceTaskCostRead = {
  a: Pick<RepairRoutePoint, "x" | "y" | "z">
  b: Pick<RepairRoutePoint, "x" | "y" | "z">
  cost: number
}

type TaskEntry = {
  context: { signature: string; references: number }
  dependencies: string
  result: CompletedClearanceSearchTask
  reads: ClearanceTaskCostRead[]
  retainedPoints: number
  retainedCharacters: number
  maxNodes: number
  layerCount: number
}

export const serializeRepairTaskDependencies = (value: unknown): string =>
  JSON.stringify(value, (_key, nested: unknown) => {
    if (typeof nested === "number" && !Number.isFinite(nested)) {
      throw new Error("Repair task dependencies contain non-finite geometry or rules")
    }
    if (["function", "symbol", "bigint"].includes(typeof nested)) {
      throw new Error("Repair task dependencies must be explicit serializable data")
    }
    return nested
  })

/**
 * Completed repair tasks retain the deterministic native search's cost reads.
 * Matching hard inputs and every ordered read response forces the same search
 * control flow, heap pops and output, even if unrelated movable copper changed.
 * A bounded no-path result remains a search outcome, never an infeasibility cut.
 */
export class ClearanceSearchTaskWorklist {
  private readonly entries = new Map<string, TaskEntry>()
  private readonly contexts = new Map<string, TaskEntry["context"]>()
  private retainedPoints = 0
  private retainedCharacters = 0
  private retainedCostReads = 0
  readonly overheadStats = {
    searchTaskSerializationCount: 0,
    searchTaskSerializedCodeUnits: 0,
    searchTaskLockDependencyChecks: 0,
    searchTaskSnapshotRoutePoints: 0,
    searchTaskCopperCandidateChecks: 0,
    searchTaskNarrowPhaseChecks: 0,
  }
  private readonly counters = {
    searchTaskLookupCount: 0,
    searchTaskDirtyCount: 0,
    searchTaskNativeInvocationCount: 0,
    searchTaskAvoidedInvocationCount: 0,
    searchTaskNativeNodesPopped: 0,
    searchTaskReusedLogicalNodes: 0,
    searchTaskStoredCount: 0,
    searchTaskEvictionCount: 0,
    searchTaskOversizedResultCount: 0,
    searchTaskDependencyReadChecks: 0,
  }

  constructor(
    readonly maxTasks = 1024,
    readonly maxRetainedPoints = 100_000,
    readonly maxRetainedCharacters = 8_000_000,
  ) {
    if (![maxTasks, maxRetainedPoints, maxRetainedCharacters].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )) throw new Error("Repair task worklist bounds must be positive safe integers")
  }

  serializeDependencies(value: unknown): string {
    const signature = serializeRepairTaskDependencies(value)
    this.overheadStats.searchTaskSerializationCount++
    // Count actual UTF-16 code units without allocating an encoded copy of
    // every board signature. This measures serialization work, not UTF-8 bytes.
    this.overheadStats.searchTaskSerializedCodeUnits += signature.length
    return signature
  }

  lookup(
    task: ClearanceSearchTask,
    edgeCost?: (a: ClearanceTaskCostRead["a"], b: ClearanceTaskCostRead["b"]) => number,
  ): CompletedClearanceSearchTask | undefined {
    this.counters.searchTaskLookupCount++
    const entry = this.entries.get(task.identity)
    if (!entry) return undefined
    if (entry.context.signature !== task.context ||
      entry.dependencies !== task.dependencies ||
      entry.maxNodes !== task.maxNodes || entry.layerCount !== task.layerCount) {
      this.remove(task.identity, entry)
      this.counters.searchTaskDirtyCount++
      return undefined
    }
    if (entry.reads.length > 0 && !edgeCost) {
      throw new Error("A repair task with dynamic dependencies requires its current edge-cost reader")
    }
    for (const read of entry.reads) {
      this.counters.searchTaskDependencyReadChecks++
      const cost = edgeCost!(read.a, read.b)
      if (Number.isNaN(cost) || cost < 0) {
        throw new Error("Repair task dependency returned an invalid edge cost")
      }
      if (!Object.is(cost, read.cost)) {
        this.remove(task.identity, entry)
        this.counters.searchTaskDirtyCount++
        return undefined
      }
    }
    this.entries.delete(task.identity)
    this.entries.set(task.identity, entry)
    this.counters.searchTaskAvoidedInvocationCount++
    this.counters.searchTaskReusedLogicalNodes += entry.result.stats.nodesPopped
    return structuredClone(entry.result)
  }

  complete(
    task: ClearanceSearchTask,
    result: CompletedClearanceSearchTask,
    reads: ClearanceTaskCostRead[] | null = [],
  ): void {
    if (!Number.isSafeInteger(task.maxNodes) || task.maxNodes < 1 ||
      !Number.isInteger(task.layerCount) || task.layerCount < 1 ||
      !Number.isSafeInteger(result.stats.nodesPopped) || result.stats.nodesPopped < 0 ||
      result.stats.nodesPopped > task.maxNodes ||
      !["found", "no-path", "node-limit"].includes(result.stats.completionReason) ||
      (result.path !== null) !== (result.stats.completionReason === "found") ||
      result.path !== null && result.path.length < 2 ||
      result.path?.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
        !Number.isInteger(point.z) || point.z < 0 || point.z >= task.layerCount)) {
      throw new Error("Only well-formed completed bounded searches may become clean repair tasks")
    }
    this.counters.searchTaskNativeInvocationCount++
    this.counters.searchTaskNativeNodesPopped += result.stats.nodesPopped
    if (reads === null) {
      this.counters.searchTaskOversizedResultCount++
      return
    }
    if (reads.some((read) => Number.isNaN(read.cost) || read.cost < 0 ||
      [read.a, read.b].some((point) => ![point.x, point.y, point.z].every(Number.isFinite)))) {
      throw new Error("Repair tasks may retain only explicit valid cost dependencies")
    }
    const retainedPoints = (result.path?.length ?? 0) + 2 * reads.length
    const retainedCharacters = task.identity.length + task.dependencies.length
    if (retainedPoints > this.maxRetainedPoints ||
      retainedCharacters + task.context.length > this.maxRetainedCharacters) {
      this.counters.searchTaskOversizedResultCount++
      return
    }
    const previous = this.entries.get(task.identity)
    if (previous) this.remove(task.identity, previous)
    let context = this.contexts.get(task.context)
    if (!context) {
      context = { signature: task.context, references: 0 }
      this.contexts.set(task.context, context)
      this.retainedCharacters += task.context.length
    }
    context.references++
    this.entries.set(task.identity, {
      context,
      dependencies: task.dependencies,
      result: structuredClone(result),
      reads: structuredClone(reads),
      retainedPoints,
      retainedCharacters,
      maxNodes: task.maxNodes,
      layerCount: task.layerCount,
    })
    this.retainedPoints += retainedPoints
    this.retainedCostReads += reads.length
    this.retainedCharacters += retainedCharacters
    this.counters.searchTaskStoredCount++
    while (this.entries.size > this.maxTasks ||
      this.retainedPoints > this.maxRetainedPoints ||
      this.retainedCharacters > this.maxRetainedCharacters) {
      const oldest = this.entries.entries().next().value
      if (!oldest) throw new Error("Repair task worklist accounting lost a retained entry")
      this.remove(oldest[0], oldest[1])
      this.counters.searchTaskEvictionCount++
    }
  }

  private remove(identity: string, entry: TaskEntry): void {
    this.entries.delete(identity)
    this.retainedPoints -= entry.retainedPoints
    this.retainedCostReads -= entry.reads.length
    this.retainedCharacters -= entry.retainedCharacters
    entry.context.references--
    if (entry.context.references === 0) {
      this.contexts.delete(entry.context.signature)
      this.retainedCharacters -= entry.context.signature.length
    }
  }

  getStats(): Record<string, number> {
    return {
      ...this.counters,
      ...this.overheadStats,
      searchTaskRetainedCount: this.entries.size,
      searchTaskRetainedPoints: this.retainedPoints,
      searchTaskRetainedCharacters: this.retainedCharacters,
      searchTaskRetainedContextCount: this.contexts.size,
      searchTaskRetainedCostReadCount: this.retainedCostReads,
    }
  }
}
