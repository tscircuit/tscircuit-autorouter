import {
  HighDensitySolverA01,
  HighDensitySolverA03,
} from "@tscircuit/high-density-a01"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

const LAZY_HD_COUNTER_KEYS = [
  "lazyHdCandidates",
  "lazyHdA01Candidates",
  "lazyHdA03Candidates",
  "lazyHdEagerCandidates",
  "lazyHdDeferredCandidates",
  "lazyHdMaterializedCandidates",
  "lazyHdDeferredA01Candidates",
  "lazyHdDeferredA03Candidates",
  "lazyHdMaterializedA01Candidates",
  "lazyHdMaterializedA03Candidates",
  "lazyHdDeferredGridCells",
  "lazyHdDeferredGridStates",
  "lazyHdMaterializedGridCells",
  "lazyHdMaterializedGridStates",
  "lazyHdMaterializationMs",
  "lazyHdBudgetWitnesses",
] as const

export type LazyHdCandidateCounters = Record<
  (typeof LAZY_HD_COUNTER_KEYS)[number],
  number
>

export type LazyHdGridPlan = {
  cells: number
  states: number
  iterationLimit: number
}

export const initializeLazyHdCandidateCounters = (
  counters: Record<string, number>,
): LazyHdCandidateCounters => {
  for (const key of LAZY_HD_COUNTER_KEYS) {
    if (!Object.hasOwn(counters, key)) counters[key] = 0
  }
  return counters as LazyHdCandidateCounters
}

const isPlainDataArray = (value: unknown): value is unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string" || (key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key))) return false
    return "value" in Object.getOwnPropertyDescriptor(value, key)!
  })
}

const isPlainDataObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object") return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(
    (descriptor) => "value" in descriptor,
  )
}

/**
 * Scope deferral to the portfolio's owned, plain finite routing geometry.
 * Native MAX starts at100M; its natural-budget floor is therefore2M. A cap
 * no greater than2M is exact without reading connection counts or building a
 * grid. Invalid/rich objects and larger budgets retain native eager setup.
 */
export const getLazyHdGridPlan = (
  node: NodeWithPortPoints,
  kind: "A01" | "A03",
  getIterationLimit: () => number,
): LazyHdGridPlan | null => {
  if (
    !isPlainDataObject(node) ||
    !isPlainDataObject(node.center) ||
    !isPlainDataArray(node.portPoints) ||
    (node.portPointsInPairs !== undefined && !isPlainDataArray(node.portPointsInPairs)) ||
    !Number.isFinite(node.width) ||
    !Number.isFinite(node.height) ||
    node.width <= 0 ||
    node.height <= 0 ||
    !Number.isFinite(node.center.x) ||
    !Number.isFinite(node.center.y)
  ) return null
  for (const point of node.portPoints) {
    if (
      !isPlainDataObject(point) ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !Number.isInteger(point.z) ||
      typeof point.connectionName !== "string" ||
      [point.rootConnectionName, point.portPointId, point.prevPortPointId, point.nextPortPointId].some((value) => value !== undefined && typeof value !== "string")
    ) return null
  }
  const availableZ = node.availableZ ?? [...new Set(node.portPoints.map((p) => p.z))]
  if (
    !isPlainDataArray(availableZ) ||
    availableZ.length === 0 ||
    availableZ.length > 64 ||
    availableZ.some((z) => !Number.isInteger(z))
  ) return null
  const iterationLimit = getIterationLimit()
  if (!Number.isFinite(iterationLimit) || iterationLimit < 1 || iterationLimit > 2_000_000) return null
  let cells: number
  if (kind === "A01") {
    const rows = Math.floor(node.height / 0.1)
    const cols = Math.floor(node.width / 0.1)
    if (rows < 1 || cols < 1) return null
    cells = rows * cols
  } else {
    const fineRows = Math.max(1, Math.ceil(node.height / 0.1))
    const fineCols = Math.max(1, Math.ceil(node.width / 0.1))
    const bandRows = Math.min(8, Math.floor(fineRows / 2))
    const bandCols = Math.min(8, Math.floor(fineCols / 2))
    const middleRows = Math.max(0, fineRows - bandRows * 2)
    const middleCols = Math.max(0, fineCols - bandCols * 2)
    cells = fineRows * bandCols * 2 + bandRows * middleCols * 2 +
      Math.ceil(middleRows / 4) * Math.ceil(middleCols / 4)
  }
  const states = cells * availableZ.length
  if (!Number.isSafeInteger(states) || states < 1 || states > 1_000_000) {
    return null
  }
  return { cells, states, iterationLimit }
}

export class LazyHighDensitySolverA01 extends HighDensitySolverA01 {
  gridMaterialized = false
  private readonly nativeIterationLimit: number

  constructor(
    props: ConstructorParameters<typeof HighDensitySolverA01>[0],
    private readonly plan: LazyHdGridPlan,
    private readonly counters: LazyHdCandidateCounters,
  ) {
    super(props)
    this.nativeIterationLimit = this.MAX_ITERATIONS
    this.MAX_ITERATIONS = plan.iterationLimit
    counters.lazyHdDeferredCandidates++
    counters.lazyHdDeferredA01Candidates++
    counters.lazyHdDeferredGridCells += plan.cells
    counters.lazyHdDeferredGridStates += plan.states
    counters.lazyHdBudgetWitnesses++
  }

  override _setup(): void {
    const admittedIterationLimit = this.MAX_ITERATIONS
    this.MAX_ITERATIONS = this.nativeIterationLimit
    const started = performance.now()
    super._setup()
    if (this.MAX_ITERATIONS < this.plan.iterationLimit) {
      throw new Error("Lazy A01 natural iteration budget violates its2M witness")
    }
    this.MAX_ITERATIONS = admittedIterationLimit
    this.gridMaterialized = true
    const grid = super.gridStats
    this.counters.lazyHdMaterializedCandidates++
    this.counters.lazyHdMaterializedA01Candidates++
    this.counters.lazyHdMaterializedGridCells += grid.cells
    this.counters.lazyHdMaterializedGridStates += grid.states
    this.counters.lazyHdMaterializationMs += performance.now() - started
  }

  override get unsolvedConnections(): HighDensitySolverA01["unsolvedConnections"] {
    if (!this.gridMaterialized) {
      this.setup()
    }
    return super.unsolvedConnections
  }

  override get solvedConnectionsMap(): HighDensitySolverA01["solvedConnectionsMap"] {
    if (!this.gridMaterialized) {
      this.setup()
    }
    return super.solvedConnectionsMap
  }

  override get gridStats(): HighDensitySolverA01["gridStats"] {
    if (!this.gridMaterialized) {
      this.setup()
    }
    return super.gridStats
  }

  override getOutput(): ReturnType<HighDensitySolverA01["getOutput"]> {
    if (!this.gridMaterialized) {
      this.setup()
    }
    return super.getOutput()
  }

  override visualize(): ReturnType<HighDensitySolverA01["visualize"]> {
    if (!this.gridMaterialized) {
      this.setup()
    }
    return super.visualize()
  }
}

export class LazyHighDensitySolverA03 extends HighDensitySolverA03 {
  gridMaterialized = false
  private readonly nativeIterationLimit: number

  constructor(
    props: ConstructorParameters<typeof HighDensitySolverA03>[0],
    private readonly plan: LazyHdGridPlan,
    private readonly counters: LazyHdCandidateCounters,
  ) {
    super(props)
    this.nativeIterationLimit = this.MAX_ITERATIONS
    this.MAX_ITERATIONS = plan.iterationLimit
    counters.lazyHdDeferredCandidates++
    counters.lazyHdDeferredA03Candidates++
    counters.lazyHdDeferredGridCells += plan.cells
    counters.lazyHdDeferredGridStates += plan.states
    counters.lazyHdBudgetWitnesses++
  }

  override _setup(): void {
    const admittedIterationLimit = this.MAX_ITERATIONS
    this.MAX_ITERATIONS = this.nativeIterationLimit
    const started = performance.now()
    super._setup()
    if (this.MAX_ITERATIONS < this.plan.iterationLimit) {
      throw new Error("Lazy A03 natural iteration budget violates its2M witness")
    }
    this.MAX_ITERATIONS = admittedIterationLimit
    this.gridMaterialized = true
    const grid = super.gridStats
    this.counters.lazyHdMaterializedCandidates++
    this.counters.lazyHdMaterializedA03Candidates++
    this.counters.lazyHdMaterializedGridCells += grid.cells
    this.counters.lazyHdMaterializedGridStates += grid.states
    this.counters.lazyHdMaterializationMs += performance.now() - started
  }

  override get unsolvedConnections(): HighDensitySolverA03["unsolvedConnections"] {
    if (!this.gridMaterialized) {
      this.setup()
    }
    return super.unsolvedConnections
  }

  override get solvedConnectionsMap(): HighDensitySolverA03["solvedConnectionsMap"] {
    if (!this.gridMaterialized) {
      this.setup()
    }
    return super.solvedConnectionsMap
  }

  override get gridStats(): HighDensitySolverA03["gridStats"] {
    if (!this.gridMaterialized) {
      this.setup()
    }
    return super.gridStats
  }

  override getOutput(): ReturnType<HighDensitySolverA03["getOutput"]> {
    if (!this.gridMaterialized) {
      this.setup()
    }
    return super.getOutput()
  }

  override visualize(): ReturnType<HighDensitySolverA03["visualize"]> {
    if (!this.gridMaterialized) {
      this.setup()
    }
    return super.visualize()
  }
}

export const isUnmaterializedLazyHdCandidate = (solver: unknown): boolean => {
  return (
    (solver instanceof LazyHighDensitySolverA01 ||
      solver instanceof LazyHighDensitySolverA03) &&
    !solver.gridMaterialized
  )
}
