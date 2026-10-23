import { SingleRouteCandidatePriorityQueue } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { BaseSolver } from "../BaseSolver"

export type RouteColumnGraph = {
  vertices: { x: number; y: number; z: number }[]
  adjacency: { to: number; primitive: number; cost: number }[][]
}
export type RouteColumnTask = { connectionName: string; owner: string; start: number; end: number }
export type RouteColumnPath = { vertices: number[]; primitives: number[] }
export type RouteColumnStats = Record<string, number>
export type RouteColumn = RouteColumnPath & { cost: number; key: string; resources: Set<number> }
export type RouteCapacityRow = { leftTask: number; leftPrimitive: number; rightTask: number; rightPrimitive: number; price: number }
export type RouteVertexCapacityRow = { leftTask: number; rightTask: number; vertex: number; price: number }
type QueueNode = { x: number; y: number; z: number; g: number; h: number; f: number; parent: null; vertex: number }
type PricingSearch = {
  task: number
  queue: SingleRouteCandidatePriorityQueue<QueueNode>
  distance: Float64Array
  parent: Int32Array
  parentPrimitive: Int32Array
  closed: Uint8Array
}
type MasterState = { selection: RouteColumn[]; depth: number }
type ColumnPair = { leftTask: number; left: RouteColumn; rightTask: number; right: RouteColumn }

/**
 * Lagrange resource prices generate complete paths from the whole graph. The
 * restricted master finds a compatible integral selection from accumulated
 * columns. Prices are a bounded search policy, not an optimality certificate.
 */
export class DualPriceRouteColumnSolver extends BaseSolver {
  readonly graph: RouteColumnGraph
  readonly tasks: readonly RouteColumnTask[]
  readonly counters: RouteColumnStats
  readonly columns: RouteColumn[][]
  readonly capacityRows: RouteCapacityRow[] = []
  readonly vertexCapacityRows: RouteVertexCapacityRow[] = []
  paths: RouteColumnPath[] = []
  private readonly rowKeys = new Set<string>()
  private readonly columnKeys: Set<string>[]
  private readonly pairConflicts = new Map<string, boolean>()
  private readonly fixedBlocks = new Map<string, boolean>()
  private readonly masterCompatibility = new Map<string, boolean>()
  private readonly masterStack: MasterState[] = []
  private readonly relaxed: RouteColumn[] = []
  private readonly resourcePairs: ColumnPair[] = []
  private readonly discoveredColumnPairs = new Set<string>()
  private prices: Map<number, number>[]
  private vertexPrices: Map<number, number>[]
  private search: PricingSearch | null = null
  private pricingTask = 0
  private round = 0
  private phase: "pricing" | "master" | "resources" | "prices" = "pricing"

  constructor(readonly params: {
    graph: RouteColumnGraph
    tasks: readonly RouteColumnTask[]
    primitivesConflict: (left: number, right: number) => boolean
    permanentlyBlocked: (task: number, primitive: number) => boolean
    ownerIndependentConflicts?: {
      primitiveIds: ReadonlySet<number>
      conflict: (left: number, right: number) => boolean
    }
    maxIterations: number
    maxRounds?: number
    includeVertexCapacityRows?: boolean
    counters?: RouteColumnStats
  }) {
    super()
    this.graph = params.graph
    this.tasks = params.tasks
    this.MAX_ITERATIONS = params.maxIterations
    this.counters = params.counters ?? {}
    this.stats = this.counters
    this.columns = params.tasks.map(() => [])
    this.columnKeys = params.tasks.map(() => new Set())
    this.prices = params.tasks.map(() => new Map())
    this.vertexPrices = params.tasks.map(() => new Map())
    this.count("routeColumnCandidateCount")
    this.count("routeColumnVertexCount", this.graph.vertices.length)
  }

  private count(key: string, amount = 1): void {
    const previous = this.counters[key]
    this.counters[key] = (previous ?? 0) + amount
    // The wrapper shares these counters with the phase, including work from
    // candidates that lose the portfolio or stop with an unknown outcome.
  }

  private conflicts(left: number, right: number, sameOwner = false): boolean {
    const independent = this.params.ownerIndependentConflicts
    if (independent?.primitiveIds.has(left) && independent.primitiveIds.has(right)) {
      const drillKey = left < right ? `drill:${left}:${right}` : `drill:${right}:${left}`
      let drillConflict = this.pairConflicts.get(drillKey)
      if (drillConflict === undefined) {
        this.count("routeColumnDrillGeometryCheckCount")
        drillConflict = independent.conflict(left, right)
        this.pairConflicts.set(drillKey, drillConflict)
      }
      if (drillConflict) return true
    }
    if (sameOwner) return false
    const key = left < right ? `${left}:${right}` : `${right}:${left}`
    let conflict = this.pairConflicts.get(key)
    if (conflict === undefined) {
      this.count("routeColumnCopperGeometryCheckCount")
      conflict = this.params.primitivesConflict(left, right)
      this.pairConflicts.set(key, conflict)
    }
    return conflict
  }

  private initializePricing(): void {
    const task = this.tasks[this.pricingTask]!
    const point = this.graph.vertices[task.start]!
    const distance = new Float64Array(this.graph.vertices.length).fill(Infinity)
    distance[task.start] = 0
    this.search = {
      task: this.pricingTask, distance,
      parent: new Int32Array(this.graph.vertices.length).fill(-1),
      parentPrimitive: new Int32Array(this.graph.vertices.length).fill(-1),
      closed: new Uint8Array(this.graph.vertices.length),
      queue: new SingleRouteCandidatePriorityQueue([{ ...point, vertex: task.start, g: 0, h: 0, f: 0, parent: null }]),
    }
    this.count("routeColumnPricingOracleCallCount")
  }

  private finishColumn(vertex: number): void {
    const search = this.search!
    const vertices = [vertex], primitives: number[] = []
    let cost = 0
    while (search.parent[vertex]! !== -1) {
      const previous = search.parent[vertex]!, primitive = search.parentPrimitive[vertex]!
      const edge = this.graph.adjacency[previous]!.find((candidate) => candidate.to === vertex && candidate.primitive === primitive)!
      cost += edge.cost
      primitives.push(primitive)
      vertex = previous
      vertices.push(vertex)
    }
    primitives.reverse()
    vertices.reverse()
    const key = primitives.join(",")
    const column: RouteColumn = { vertices, primitives, cost, key, resources: new Set(primitives) }
    this.relaxed[search.task] = column
    if (!this.columnKeys[search.task]!.has(key)) {
      this.columnKeys[search.task]!.add(key)
      this.columns[search.task]!.push(column)
      this.count("routeColumnGeneratedColumnCount")
      this.counters.routeColumnMaxColumnsPerTask = Math.max(this.counters.routeColumnMaxColumnsPerTask ?? 0, this.columns[search.task]!.length)
      if (this.round > 0) this.count("routeColumnNewPricedColumnCount")
    } else {
      this.count("routeColumnDuplicateColumnCount")
    }
    this.pricingTask++
    this.search = null
    if (this.pricingTask === this.tasks.length) {
      this.masterStack.push({ selection: [], depth: 0 })
      this.phase = "master"
      this.count("routeColumnMasterAttemptCount")
    }
  }

  private stepPricing(): void {
    if (!this.search) this.initializePricing()
    const search = this.search!
    let current = search.queue.dequeue()
    while (current && search.closed[current.vertex]) current = search.queue.dequeue()
    if (!current) {
      this.failed = true
      this.error = "Route column oracle exhausted its finite graph; board feasibility remains unknown"
      this.count("routeColumnOracleExhaustionCount")
      return
    }
    search.closed[current.vertex] = 1
    this.count("routeColumnExpandedVertexCount")
    if (current.vertex === this.tasks[search.task]!.end) { this.finishColumn(current.vertex); return }
    for (const edge of this.graph.adjacency[current.vertex]!) {
      if (search.closed[edge.to]) continue
      const fixedKey = `${search.task}:${edge.primitive}`
      let fixed = this.fixedBlocks.get(fixedKey)
      if (fixed === undefined) {
        this.count("routeColumnFixedGeometryCheckCount")
        fixed = this.params.permanentlyBlocked(search.task, edge.primitive)
        this.fixedBlocks.set(fixedKey, fixed)
      }
      if (fixed) continue
      const distance = current.g + edge.cost + (this.prices[search.task]!.get(edge.primitive) ?? 0) + (this.vertexPrices[search.task]!.get(edge.to) ?? 0)
      if (distance >= search.distance[edge.to]!) continue
      search.distance[edge.to] = distance
      search.parent[edge.to] = current.vertex
      search.parentPrimitive[edge.to] = edge.primitive
      const point = this.graph.vertices[edge.to]!
      search.queue.enqueue({ ...point, vertex: edge.to, g: distance, h: 0, f: distance, parent: null })
    }
  }

  private columnsCompatible(leftTask: number, left: RouteColumn, rightTask: number, right: RouteColumn): boolean {
    const sameOwner = this.tasks[leftTask]!.owner === this.tasks[rightTask]!.owner
    if (sameOwner && !this.params.ownerIndependentConflicts) return true
    const key = `${leftTask}:${left.key}|${rightTask}:${right.key}`
    const known = this.masterCompatibility.get(key)
    if (known !== undefined) return known
    for (const a of left.resources) for (const b of right.resources) {
      if (!this.conflicts(a, b, sameOwner)) continue
      this.masterCompatibility.set(key, false)
      return false
    }
    this.masterCompatibility.set(key, true)
    return true
  }

  private stepMaster(): void {
    const state = this.masterStack.pop()
    if (!state) {
      this.count("routeColumnRestrictedMasterExhaustionCount")
      this.initializeResourceDiscovery()
      return
    }
    this.count("routeColumnMasterSearchStateCount")
    if (state.depth === this.tasks.length) {
      this.paths = state.selection.map((column) => ({ vertices: column.vertices, primitives: column.primitives }))
      this.solved = true
      this.progress = 1
      this.count("routeColumnCompatibleMasterSuccessCount")
      return
    }
    const candidates = [...this.columns[state.depth]!].sort((a, b) => b.cost - a.cost)
    for (const candidate of candidates) {
      if (!state.selection.every((selected, task) => this.columnsCompatible(task, selected, state.depth, candidate))) continue
      this.masterStack.push({ selection: [...state.selection, candidate], depth: state.depth + 1 })
      this.counters.routeColumnMaxMasterStackWidth = Math.max(this.counters.routeColumnMaxMasterStackWidth ?? 0, this.masterStack.length)
    }
  }

  private initializeResourceDiscovery(): void {
    for (let a = 0; a < this.tasks.length; a++) for (let b = a + 1; b < this.tasks.length; b++) {
      if (this.tasks[a]!.owner === this.tasks[b]!.owner && !this.params.ownerIndependentConflicts) continue
      for (const left of this.columns[a]!) for (const right of this.columns[b]!) {
        const key = `${a}:${left.key}|${b}:${right.key}`
        if (this.discoveredColumnPairs.has(key)) continue
        this.discoveredColumnPairs.add(key)
        this.resourcePairs.push({ leftTask: a, left, rightTask: b, right })
      }
    }
    this.counters.routeColumnMaxResourcePoolWidth = Math.max(this.counters.routeColumnMaxResourcePoolWidth ?? 0, this.resourcePairs.length)
    this.phase = "resources"
  }

  private discoverResourceRows(): void {
    const pair = this.resourcePairs.pop()
    if (!pair) { this.phase = "prices"; return }
    const { leftTask: a, left, rightTask: b, right } = pair
    const sameOwner = this.tasks[a]!.owner === this.tasks[b]!.owner
    this.count("routeColumnResourcePoolPairCount")
    if (this.params.includeVertexCapacityRows && !sameOwner) {
      for (const vertex of left.vertices) {
        if (!right.vertices.includes(vertex)) continue
        const key = `vertex:${a}:${vertex}:${b}`
        if (this.rowKeys.has(key)) continue
        this.rowKeys.add(key)
        this.vertexCapacityRows.push({ leftTask: a, rightTask: b, vertex, price: 0 })
        this.count("routeColumnVertexCapacityRowCount")
      }
    }
    for (const leftPrimitive of left.resources) for (const rightPrimitive of right.resources) {
      if (!this.conflicts(leftPrimitive, rightPrimitive, sameOwner)) continue
      const key = `${a}:${leftPrimitive}|${b}:${rightPrimitive}`
      if (this.rowKeys.has(key)) continue
      this.rowKeys.add(key)
      this.capacityRows.push({ leftTask: a, leftPrimitive, rightTask: b, rightPrimitive, price: 0 })
      this.count("routeColumnCapacityRowCount")
    }
  }

  private updatePrices(): void {
    const step = Math.max(1, this.relaxed.reduce((sum, column) => sum + column.cost, 0) / Math.max(1, this.tasks.length)) / Math.sqrt(this.round + 1)
    this.prices = this.tasks.map(() => new Map())
    this.vertexPrices = this.tasks.map(() => new Map())
    for (const row of this.capacityRows) {
      const used = Number(this.relaxed[row.leftTask]!.resources.has(row.leftPrimitive)) + Number(this.relaxed[row.rightTask]!.resources.has(row.rightPrimitive))
      if (used > 1) this.count("routeColumnViolatedCapacityRowCount")
      row.price = Math.max(0, row.price + step * (used - 1))
      this.count("routeColumnPriceUpdateCount")
      for (const [task, primitive] of [[row.leftTask, row.leftPrimitive], [row.rightTask, row.rightPrimitive]]) {
        this.prices[task!]!.set(primitive!, (this.prices[task!]!.get(primitive!) ?? 0) + row.price)
      }
    }
    // Vertex rows price an entire shared junction, rather than repeatedly
    // rediscovering whichever incident edge a path happens to choose. Positive
    // costs make the oracle path simple, so each vertex is charged once.
    for (const row of this.vertexCapacityRows) {
      const used = Number(this.relaxed[row.leftTask]!.vertices.includes(row.vertex)) + Number(this.relaxed[row.rightTask]!.vertices.includes(row.vertex))
      if (used > 1) this.count("routeColumnViolatedVertexCapacityRowCount")
      row.price = Math.max(0, row.price + step * (used - 1))
      this.count("routeColumnPriceUpdateCount")
      for (const task of [row.leftTask, row.rightTask]) {
        this.vertexPrices[task]!.set(row.vertex, (this.vertexPrices[task]!.get(row.vertex) ?? 0) + row.price)
      }
    }
    this.round++
    this.count("routeColumnPricingRoundCount")
    if (this.round >= (this.params.maxRounds ?? 64)) {
      this.failed = true
      this.error = "Priced route-column policy exhausted its round budget; feasibility remains unknown"
      this.count("routeColumnRoundBudgetExhaustionCount")
      return
    }
    this.pricingTask = 0
    this.phase = "pricing"
  }

  override _step(): void {
    if (this.phase === "pricing") this.stepPricing()
    else if (this.phase === "master") this.stepMaster()
    else if (this.phase === "resources") this.discoverResourceRows()
    else this.updatePrices()
    if (!this.solved) this.progress = Math.min(0.95, this.columns.filter((columns) => columns.length > 0).length / Math.max(1, this.tasks.length) * 0.6 + this.round / (this.params.maxRounds ?? 64) * 0.3)
  }

  override tryFinalAcceptance(): void {
    if (this.solved || this.failed) return
    this.count("routeColumnBudgetExhaustionCount")
    // No missing column, partial master search, or work limit establishes
    // infeasibility, and none is exported as an upstream routing exclusion.
  }
}
