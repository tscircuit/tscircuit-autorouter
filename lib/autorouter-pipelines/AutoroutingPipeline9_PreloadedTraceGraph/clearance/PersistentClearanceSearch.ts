import type { Bounds, RepairRoutePoint } from "./repairRegionTypes"
import { REGION_EPSILON } from "./repairRegionGeometry"

type Point = RepairRoutePoint
const MAX_EXACT_SUBSET_HISTORY = 5
const MAX_EXACT_SUBSET_KEYS = 2 ** MAX_EXACT_SUBSET_HISTORY - MAX_EXACT_SUBSET_HISTORY - 2
type History = { key: string; sites: number[]; maskA: number; maskB: number }
type Vertex = {
  id: number
  kind: "source" | "grid" | "goal"
  gridId: number
  point: Point
  history: History
  g: number
  rhs: number
  parent?: Edge
  incoming: Edge[]
  outgoing: Edge[]
  generated: boolean
  overconsistentEpoch: number
  expandedGeneration: number
}
type Edge = { id: number; from: Vertex; to: Vertex; cost: number }
type QueueEntry = { id: number; first: number; second: number; third: number }
type DirtyOperation = { kind: "region" } | { kind: "cell" } | { kind: "candidate" } | { kind: "edge"; edge: Edge }

export type PersistentClearanceProblem = {
  start: Point
  end: Point
  bounds: Bounds
  grid: number
  layerCount: number
  traceThickness: number
  drillSpacing: number
  allowLayerChanges: boolean
  heuristicWeight?: number
  dominanceWitnessLimit?: number
}

export type PersistentClearanceQuery = {
  revision: number
  changes: Bounds[]
  clear: (a: Point, b: Point) => boolean
  extraCost: (a: Point, b: Point) => number
}

export type PersistentClearanceStats = {
  workUnits: number
  nodesPopped: number
  neighborGenerations: number
  predecessorChecks: number
  queueUpdates: number
  invalidationCells: number
  invalidationRegions: number
  invalidationCandidates: number
  invalidatedEdges: number
  changedEdges: number
  validationChecks: number
  simplificationChecks: number
  historyChecks: number
  reusedQueries: number
  reusedLabels: number
  reusedFrontierEntries: number
  retainedStates: number
  retainedEdges: number
  completionReason: "found" | "no-path" | "node-limit"
  maximumPoppedNodes: number
  maximumMaintenanceWorkUnits: number
  poppedNodeLimitReached: number
  maintenanceLimitReached: number
  dominanceWitnessChecks: number
  dominanceSubsetChecks: number
  dominanceIndexWork: number
  dominanceSuppressed: number
  dominanceReactivated: number
  dominanceMaskRejections: number
  dominanceSubsetKeyQueries: number
  dominanceSubsetKeyMaskChecks: number
  dominanceSubsetKeySiteChecks: number
  dominanceSubsetKeysGenerated: number
  dominanceSubsetKeyProbes: number
  dominanceSubsetKeyHits: number
  dominanceSubsetKeySuccesses: number
  retainedDominantStates: number
}

/** Indexed lexicographic queue: LPA* must increase as well as decrease keys. */
class InconsistentQueue {
  readonly values: QueueEntry[] = []
  private readonly positions = new Map<number, number>()

  private less(a: QueueEntry, b: QueueEntry): boolean {
    if (a.first !== b.first) return a.first < b.first
    if (a.second !== b.second) return a.second < b.second
    if (a.third !== b.third) return a.third < b.third
    // Stable IDs break exact ties without changing the two-component key.
    const ordered = a.id < b.id
    return ordered
  }

  remove(id: number): void {
    const index = this.positions.get(id)
    if (index === undefined) return
    const last = this.values.pop()!
    this.positions.delete(id)
    if (index === this.values.length) return
    this.values[index] = last
    this.positions.set(last.id, index)
    this.repair(index)
  }

  private repair(initial: number): void {
    let index = initial
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (!this.less(this.values[index]!, this.values[parent]!)) break
      this.swap(index, parent)
      index = parent
    }
    while (index * 2 + 1 < this.values.length) {
      let child = index * 2 + 1
      if (child + 1 < this.values.length &&
        this.less(this.values[child + 1]!, this.values[child]!)) child++
      if (!this.less(this.values[child]!, this.values[index]!)) break
      this.swap(index, child)
      index = child
    }
  }

  private swap(a: number, b: number): void {
    const left = this.values[a]!
    const right = this.values[b]!
    this.values[a] = right
    this.values[b] = left
    this.positions.set(left.id, b)
    this.positions.set(right.id, a)
  }

  set(entry: QueueEntry): void {
    this.remove(entry.id)
    const index = this.values.length
    this.values.push(entry)
    this.positions.set(entry.id, index)
    this.repair(index)
  }
}

/**
 * Generalized LPA* over a lazy drill-history-lifted grid.
 * Sources: Koenig/Likhachev/Furcy, AIJ2004, and Likhachev/Koenig,
 * "A Generalized Framework for Lifelong Planning A* Search", ICAPS2005.
 * Underconsistent states use a consistent key; overconsistent states use the
 * configured native weighted heuristic and expand at most once per query.
 * g/rhs, all generated edges and the inconsistent frontier survive queries.
 */
export class PersistentClearanceSearch {
  readonly stats: PersistentClearanceStats
  readonly problem: PersistentClearanceProblem
  private readonly nx: number
  private readonly ny: number
  private readonly vertices: Vertex[] = []
  private readonly gridVertices = new Map<string, Vertex>()
  private readonly histories = new Map<string, History>()
  private readonly edges: Edge[] = []
  private readonly edgeCells = new Map<string, Set<Edge>>()
  private readonly queue = new InconsistentQueue()
  private readonly dirty: Array<Generator<DirtyOperation>> = []
  private readonly changedTargets = new Set<Vertex>()
  private readonly deferred = new Set<Vertex>()
  private readonly dominanceSuppressed = new Set<Vertex>()
  private readonly dominanceWitnesses = new Map<number, Vertex[]>()
  private readonly emptyHistoryWitnesses = new Map<number, Vertex>()
  private readonly singleHistoryWitnesses = new Map<number, Map<number, Vertex>>()
  private wakeDominance = false
  private readonly source: Vertex
  private readonly goal: Vertex
  private query?: PersistentClearanceQuery
  private computation?: Generator<void, Point[] | null>
  private generation = 0
  private queryCount = 0
  private epoch = 0
  private restoreDeferred = false
  private finiteLabels = 0
  private maximumHistoryLength = 0
  private pendingChangeCount = 0
  private aboutToPop = false
  private readonly spatialCellSize: number
  private readonly workspaceBounds: Bounds
  private result?: Point[] | null

  constructor(problem: PersistentClearanceProblem) {
    this.problem = structuredClone(problem)
    if (![problem.grid, problem.traceThickness, problem.drillSpacing,
      problem.bounds.minX, problem.bounds.maxX, problem.bounds.minY, problem.bounds.maxY,
      problem.start.x, problem.start.y, problem.end.x, problem.end.y].every(Number.isFinite) ||
      problem.traceThickness <= 0 || problem.drillSpacing <= 0 ||
      !Number.isFinite(problem.heuristicWeight ?? 1) || (problem.heuristicWeight ?? 1) < 1 ||
      !Number.isSafeInteger(problem.dominanceWitnessLimit ?? 32) || (problem.dominanceWitnessLimit ?? 32) < 0 || (problem.dominanceWitnessLimit ?? 32) > 32 ||
      !Number.isSafeInteger(problem.layerCount) || problem.layerCount < 1 ||
      ![problem.start.z, problem.end.z].every((z) => Number.isSafeInteger(z) && z >= 0 && z < problem.layerCount)) {
      throw new Error("Persistent clearance requires finite physical geometry and valid layers")
    }
    this.nx = Math.floor((problem.bounds.maxX - problem.bounds.minX) / problem.grid)
    this.ny = Math.floor((problem.bounds.maxY - problem.bounds.minY) / problem.grid)
    if (problem.grid <= Number.EPSILON * Math.max(Math.abs(problem.bounds.minX), Math.abs(problem.bounds.maxX),
      Math.abs(problem.bounds.minY), Math.abs(problem.bounds.maxY))) {
      throw new Error("Persistent clearance grid spacing is below coordinate precision")
    }
    const anchorReach = Math.max(
      problem.bounds.minX - problem.start.x, problem.start.x - problem.bounds.maxX,
      problem.bounds.minY - problem.start.y, problem.start.y - problem.bounds.maxY, 0,
    )
    this.spatialCellSize = Math.max(1, problem.grid * 4 + anchorReach)
    this.workspaceBounds = {
      minX: Math.min(problem.bounds.minX, problem.start.x, problem.end.x),
      maxX: Math.max(problem.bounds.maxX, problem.start.x, problem.end.x),
      minY: Math.min(problem.bounds.minY, problem.start.y, problem.end.y),
      maxY: Math.max(problem.bounds.maxY, problem.start.y, problem.end.y),
    }
    if (!Number.isSafeInteger(this.nx * this.ny * problem.layerCount) ||
      this.nx < 1 || this.ny < 1 || problem.grid <= 0) {
      throw new Error("Persistent clearance requires a finite nonempty grid")
    }
    const history = { key: "", sites: [], maskA: 0, maskB: 0 }
    this.histories.set("", history)
    this.source = this.createVertex("source", -1, problem.start, history)
    this.goal = this.createVertex("goal", -1, problem.end, history)
    this.source.rhs = 0
    this.queue.set(this.key(this.source))
    this.stats = {
      workUnits: 0, nodesPopped: 0, neighborGenerations: 0,
      predecessorChecks: 0, queueUpdates: 0, invalidationCells: 0, invalidationRegions: 0, invalidationCandidates: 0, invalidatedEdges: 0,
      changedEdges: 0, validationChecks: 0, simplificationChecks: 0, historyChecks: 0,
      reusedQueries: 0, reusedLabels: 0, reusedFrontierEntries: 0,
      retainedStates: 2, retainedEdges: 0, completionReason: "no-path",
      maximumPoppedNodes: 0, maximumMaintenanceWorkUnits: 0,
      poppedNodeLimitReached: 0, maintenanceLimitReached: 0,
      dominanceWitnessChecks: 0, dominanceSubsetChecks: 0, dominanceIndexWork: 0,
      dominanceSuppressed: 0, dominanceReactivated: 0, retainedDominantStates: 0,
      dominanceMaskRejections: 0,
      dominanceSubsetKeyQueries: 0, dominanceSubsetKeyMaskChecks: 0,
      dominanceSubsetKeySiteChecks: 0, dominanceSubsetKeysGenerated: 0,
      dominanceSubsetKeyProbes: 0, dominanceSubsetKeyHits: 0,
      dominanceSubsetKeySuccesses: 0,
    }
  }

  begin(query: PersistentClearanceQuery): void {
    if (!Number.isSafeInteger(query.revision) || query.revision < 0 ||
      query.changes.some((bounds) =>
        ![bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(Number.isFinite) ||
        bounds.minX > bounds.maxX || bounds.minY > bounds.maxY)) {
      throw new Error("Persistent clearance query has an invalid scene revision or change bounds")
    }
    if (this.query && query.revision < this.query.revision) {
      throw new Error("Persistent clearance scene revisions cannot go backwards")
    }
    if (query.changes.length) {
      this.generation++
      this.wakeDominance = true
      this.pendingChangeCount += query.changes.length
      this.dirty.push(this.dirtyEdges(query.changes))
    }
    this.query = query
    this.epoch++
    this.restoreDeferred = true
    this.result = undefined
    this.stats.workUnits = 0
    this.stats.nodesPopped = 0
    this.stats.neighborGenerations = 0
    this.stats.predecessorChecks = 0
    this.stats.queueUpdates = 0
    this.stats.invalidationCells = 0
    this.stats.invalidationRegions = 0
    this.stats.invalidationCandidates = 0
    this.stats.invalidatedEdges = 0
    this.stats.changedEdges = 0
    this.stats.validationChecks = 0
    this.stats.simplificationChecks = 0
    this.stats.historyChecks = 0
    this.stats.reusedQueries = this.queryCount++ > 0 ? 1 : 0
    this.stats.reusedLabels = this.stats.reusedQueries ? this.finiteLabels : 0
    this.stats.reusedFrontierEntries = this.stats.reusedQueries ? this.queue.values.length : 0
    this.stats.completionReason = "no-path"
    this.stats.poppedNodeLimitReached = 0
    this.stats.maintenanceLimitReached = 0
    this.stats.dominanceWitnessChecks = 0
    this.stats.dominanceSubsetChecks = 0
    this.stats.dominanceIndexWork = 0
    this.stats.dominanceSuppressed = 0
    this.stats.dominanceReactivated = 0
    this.stats.dominanceMaskRejections = 0
    this.stats.dominanceSubsetKeyQueries = 0
    this.stats.dominanceSubsetKeyMaskChecks = 0
    this.stats.dominanceSubsetKeySiteChecks = 0
    this.stats.dominanceSubsetKeysGenerated = 0
    this.stats.dominanceSubsetKeyProbes = 0
    this.stats.dominanceSubsetKeyHits = 0
    this.stats.dominanceSubsetKeySuccesses = 0
    if (!this.computation) this.computation = this.repair()
  }

  advance(maximumWork: number): boolean {
    if (!this.query) throw new Error("Persistent clearance query was not begun")
    for (let index = 0; index < maximumWork; index++) {
      if (this.aboutToPop && this.stats.maximumPoppedNodes > 0 &&
        this.stats.nodesPopped >= this.stats.maximumPoppedNodes) {
        this.stats.completionReason = "node-limit"
        this.stats.poppedNodeLimitReached = 1
        return false
      }
      const next = this.computation!.next()
      if (next.done) {
        this.result = next.value
        this.computation = undefined
        this.stats.completionReason = next.value ? "found" : "no-path"
        this.stats.retainedStates = this.vertices.length
        this.stats.retainedEdges = this.edges.length
        this.stats.retainedDominantStates = this.dominanceSuppressed.size
        return true
      }
      this.stats.workUnits++
    }
    this.stats.retainedStates = this.vertices.length
    this.stats.retainedEdges = this.edges.length
    this.stats.retainedDominantStates = this.dominanceSuppressed.size
    this.stats.completionReason = "node-limit"
    return false
  }

  configureBudget(maximumPoppedNodes: number): number {
    if (!Number.isSafeInteger(maximumPoppedNodes) || maximumPoppedNodes < 1) {
      throw new Error("Persistent clearance pop allowance must be a positive safe integer")
    }
    const degree = Math.max(25, 8 + this.problem.layerCount)
    const incomingGridDegree = 9 + 2 * (this.problem.layerCount - 1)
    const edgeBound = this.edges.length + maximumPoppedNodes * degree
    const historyBound = Math.min(this.nx * this.ny,
      this.maximumHistoryLength + maximumPoppedNodes)
    const pathBound = this.finiteLabels + maximumPoppedNodes + 2
    const cells = (Math.ceil((this.workspaceBounds.maxX - this.workspaceBounds.minX) / this.spatialCellSize) + 2) *
      (Math.ceil((this.workspaceBounds.maxY - this.workspaceBounds.minY) / this.spatialCellSize) + 2)
    // Finite domain bounds, not a tuned work/pop conversion: every generated
    // edge, incoming-grid relaxation, drill-history visit, goal predecessor
    // scan, dirty-cell membership and quadratic path simplification is covered.
    const maintenance = maximumPoppedNodes * (3 * degree + incomingGridDegree * degree + historyBound + 8 + edgeBound) +
      this.pendingChangeCount * (cells + 6 * edgeBound + 1) + edgeBound +
      pathBound * pathBound + pathBound * 4 + 128
    const dominance = (3 * maximumPoppedNodes * degree + 2 * edgeBound) *
      (this.problem.dominanceWitnessLimit ?? 32) * (2 * historyBound + 4) + edgeBound
    // Exact subset lookup adds at most one query, all proper mask visits,
    // and bounded site/key/probe work; this never changes actual pop allowance.
    const exactSubsetWork = this.problem.dominanceWitnessLimit === 0 ? 0 :
      (3 * maximumPoppedNodes * degree + 2 * edgeBound) *
      (1 + 2 ** MAX_EXACT_SUBSET_HISTORY - 2 + MAX_EXACT_SUBSET_KEYS * (MAX_EXACT_SUBSET_HISTORY + 2))
    const totalMaintenance = maintenance + dominance + exactSubsetWork
    if (!Number.isSafeInteger(totalMaintenance)) {
      throw new Error("Persistent clearance maintenance allowance exceeds exact accounting range")
    }
    this.stats.maximumPoppedNodes = maximumPoppedNodes
    this.stats.maximumMaintenanceWorkUnits = totalMaintenance
    return totalMaintenance
  }

  getOutput(): Point[] | null {
    if (this.result === undefined) {
      throw new Error("Persistent clearance output requested before completion")
    }
    const output = this.result
    return output?.map((point) => ({ ...point })) ?? null
  }

  getSolutionCost(): number {
    if (this.result === undefined || this.result === null) {
      throw new Error("Persistent clearance has no completed path cost")
    }
    const cost = this.goal.g
    return cost
  }

  private createVertex(kind: Vertex["kind"], gridId: number, point: Point, history: History): Vertex {
    const vertex: Vertex = {
      id: this.vertices.length, kind, gridId, point: { ...point }, history,
      g: Infinity, rhs: Infinity, incoming: [], outgoing: [], generated: false,
      overconsistentEpoch: -1,
      expandedGeneration: -1,
    }
    this.vertices.push(vertex)
    return vertex
  }

  private key(vertex: Vertex): QueueEntry {
    const minimum = Math.min(vertex.g, vertex.rhs)
    const heuristic = vertex.kind === "goal" ? 0 :
      Math.hypot(vertex.point.x - this.problem.end.x, vertex.point.y - this.problem.end.y) +
      (vertex.point.z === this.problem.end.z ? 0 : 1)
    // GLPA* prioritizes stale underestimates with the consistent heuristic, so
    // changed ancestors are repaired before any dependent goal can terminate.
    const weight = vertex.g < vertex.rhs ? 1 : this.problem.heuristicWeight ?? 1
    // Native anchors can exactly coincide with a grid point, giving a zero-cost
    // connector. GLPA* assumes positive edges; this final tie component forces
    // an equally keyed stale predecessor ahead of a consistent virtual goal.
    return { id: vertex.id, first: minimum + weight * heuristic, second: minimum,
      third: vertex.g < vertex.rhs ? -1 : 0 }
  }

  private gridVertex(gridId: number, history: History): Vertex {
    const key = `${gridId}|${history.key}`
    const existing = this.gridVertices.get(key)
    if (existing) return existing
    const point: Point = {
      x: this.problem.bounds.minX + ((gridId % this.nx) + 0.5) * this.problem.grid,
      y: this.problem.bounds.minY + ((Math.floor(gridId / this.nx) % this.ny) + 0.5) * this.problem.grid,
      z: Math.floor(gridId / (this.nx * this.ny)),
      traceThickness: this.problem.traceThickness,
    }
    const vertex = this.createVertex("grid", gridId, point, history)
    this.gridVertices.set(key, vertex)
    return vertex
  }

  private cost(a: Point, b: Point): number {
    if (!this.query!.clear(a, b)) return Infinity
    const additional = this.query!.extraCost(a, b)
    if (Number.isNaN(additional) || additional < 0) {
      throw new Error("Persistent clearance edge cost must be nonnegative")
    }
    return (a.z === b.z ? Math.hypot(a.x - b.x, a.y - b.y) : 1) + additional
  }

  private addEdge(from: Vertex, to: Vertex): void {
    // Only virtual anchor connectors may have zero cost. Source has no incoming
    // edges and goal no outgoing edges, so those connectors cannot form a cycle.
    if (from.kind === "grid" && to.kind === "grid" && from.point.z === to.point.z &&
      from.point.x === to.point.x && from.point.y === to.point.y) {
      throw new Error("Persistent clearance grid step collapsed at coordinate precision")
    }
    const edge: Edge = { id: this.edges.length, from, to, cost: this.cost(from.point, to.point) }
    this.edges.push(edge)
    from.outgoing.push(edge)
    to.incoming.push(edge)
    for (let x = Math.floor(Math.min(from.point.x, to.point.x) / this.spatialCellSize);
      x <= Math.floor(Math.max(from.point.x, to.point.x) / this.spatialCellSize); x++) {
      for (let y = Math.floor(Math.min(from.point.y, to.point.y) / this.spatialCellSize);
        y <= Math.floor(Math.max(from.point.y, to.point.y) / this.spatialCellSize); y++) {
        const key = `${x},${y}`
        const bucket = this.edgeCells.get(key)
        if (bucket) bucket.add(edge)
        else this.edgeCells.set(key, new Set([edge]))
      }
    }
  }

  private *nextHistory(vertex: Vertex): Generator<void, History | undefined> {
    const site = vertex.gridId % (this.nx * this.ny)
    for (const previous of vertex.history.sites) {
      this.stats.historyChecks++
      yield
      if (previous === site) return vertex.history
      const dx = (site % this.nx) - (previous % this.nx)
      const dy = Math.floor(site / this.nx) - Math.floor(previous / this.nx)
      if (Math.hypot(dx, dy) * this.problem.grid + REGION_EPSILON < this.problem.drillSpacing) {
        return undefined
      }
    }
    const sites = [...vertex.history.sites]
    let insertion = sites.length
    while (insertion > 0 && sites[insertion - 1]! > site) insertion--
    sites.splice(insertion, 0, site)
    const key = sites.join(",")
    let history = this.histories.get(key)
    if (!history) {
      const hash = Math.imul(site ^ (site >>> 16), 0x9e3779b1)
      history = { key, sites, maskA: vertex.history.maskA | (1 << (hash & 31)),
        maskB: vertex.history.maskB | (1 << ((hash >>> 5) & 31)) }
      this.histories.set(key, history)
      this.maximumHistoryLength = Math.max(this.maximumHistoryLength, sites.length)
    }
    return history
  }

  private *generate(vertex: Vertex): Generator<void> {
    if (vertex.generated) return
    const { point } = vertex
    if (vertex.kind === "source") {
      const sx = Math.max(0, Math.min(this.nx - 1, Math.floor((point.x - this.problem.bounds.minX) / this.problem.grid)))
      const sy = Math.max(0, Math.min(this.ny - 1, Math.floor((point.y - this.problem.bounds.minY) / this.problem.grid)))
      for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
        const x = sx + dx, y = sy + dy
        this.stats.neighborGenerations++
        yield
        if (x < 0 || x >= this.nx || y < 0 || y >= this.ny) continue
        this.addEdge(vertex, this.gridVertex((point.z * this.ny + y) * this.nx + x, vertex.history))
      }
    } else if (vertex.kind === "grid") {
      const x = vertex.gridId % this.nx, y = Math.floor(vertex.gridId / this.nx) % this.ny
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue
        this.stats.neighborGenerations++
        yield
        if (x + dx < 0 || x + dx >= this.nx || y + dy < 0 || y + dy >= this.ny) continue
        this.addEdge(vertex, this.gridVertex((point.z * this.ny + y + dy) * this.nx + x + dx, vertex.history))
      }
      if (this.problem.allowLayerChanges) {
        const history = yield* this.nextHistory(vertex)
        if (history) for (let z = 0; z < this.problem.layerCount; z++) {
          if (z === point.z) continue
          this.stats.neighborGenerations++
          yield
          this.addEdge(vertex, this.gridVertex((z * this.ny + y) * this.nx + x, history))
        }
      }
      if (point.z === this.problem.end.z &&
        Math.hypot(point.x - this.problem.end.x, point.y - this.problem.end.y) < this.problem.grid * 3) {
        this.stats.neighborGenerations++
        yield
        this.addEdge(vertex, this.goal)
      }
    }
    vertex.generated = true
  }

  private *update(vertex: Vertex): Generator<void> {
    if (vertex !== this.source) {
      let rhs = Infinity
      let parent: Edge | undefined
      for (const edge of vertex.incoming) {
        this.stats.predecessorChecks++
        yield
        const candidate = edge.from.g + edge.cost
        if (candidate < rhs || (candidate === rhs && edge.id < (parent?.id ?? Infinity))) {
          rhs = candidate
          parent = edge
        }
      }
      vertex.rhs = rhs
      vertex.parent = parent
    }
    yield* this.touch(vertex)
  }

  private *touch(vertex: Vertex): Generator<void> {
    this.stats.queueUpdates++
    if (vertex.g !== vertex.rhs && vertex.overconsistentEpoch === this.epoch) {
      this.queue.remove(vertex.id)
      this.deferred.add(vertex)
    } else if (vertex.g > vertex.rhs && (yield* this.isDominated(vertex))) {
      this.queue.remove(vertex.id)
      if (!this.dominanceSuppressed.has(vertex)) this.stats.dominanceSuppressed++
      this.dominanceSuppressed.add(vertex)
    } else if (vertex.g !== vertex.rhs) {
      this.dominanceSuppressed.delete(vertex)
      this.queue.set(this.key(vertex))
    } else {
      this.queue.remove(vertex.id)
      this.deferred.delete(vertex)
      this.dominanceSuppressed.delete(vertex)
    }
    yield
  }

  private *isDominated(vertex: Vertex): Generator<void, boolean> {
    if (vertex.kind !== "grid" || this.problem.dominanceWitnessLimit === 0) return false
    const generation = this.generation
    this.stats.dominanceIndexWork++
    yield
    const empty = this.emptyHistoryWitnesses.get(vertex.gridId)
    if (empty) this.stats.dominanceWitnessChecks++
    if (generation !== this.generation) return false
    if (empty && empty !== vertex && empty.expandedGeneration === generation && empty.g >= empty.rhs && empty.g <= vertex.rhs) return true
    const singles = this.singleHistoryWitnesses.get(vertex.gridId)
    for (const site of vertex.history.sites) {
      this.stats.dominanceIndexWork++
      yield
      if (generation !== this.generation) return false
      const witness = singles?.get(site)
      if (witness) this.stats.dominanceWitnessChecks++
      if (witness && witness !== vertex && witness.expandedGeneration === generation && witness.g >= witness.rhs && witness.g <= vertex.rhs) return true
    }
    if (vertex.history.sites.length <= MAX_EXACT_SUBSET_HISTORY) {
      // At most25 keys at length5, rather than scanning unrelated witnesses.
      // Sorted histories give exactly the same canonical key as gridVertex.
      // Empty/singleton histories were checked above; exclude the full history
      // because its unique existing state is this candidate, not a witness.
      this.stats.dominanceSubsetKeyQueries++
      yield
      if (generation !== this.generation) return false
      const fullMask = (1 << vertex.history.sites.length) - 1
      for (let mask = 1; mask < fullMask; mask++) {
        this.stats.dominanceSubsetKeyMaskChecks++
        yield
        if (generation !== this.generation) return false
        if ((mask & (mask - 1)) === 0) continue
        const sites: number[] = []
        for (let index = 0; index < vertex.history.sites.length; index++) {
          this.stats.dominanceSubsetKeySiteChecks++
          yield
          if (generation !== this.generation) return false
          if (mask & (1 << index)) sites.push(vertex.history.sites[index]!)
        }
        const key = `${vertex.gridId}|${sites.join(",")}`
        this.stats.dominanceSubsetKeysGenerated++
        yield
        if (generation !== this.generation) return false
        const witness = this.gridVertices.get(key)
        this.stats.dominanceSubsetKeyProbes++
        if (witness) {
          this.stats.dominanceSubsetKeyHits++
          this.stats.dominanceWitnessChecks++
        }
        yield
        if (generation !== this.generation) return false
        if (witness && witness !== vertex && witness.expandedGeneration === generation &&
          Number.isFinite(witness.g) && witness.g >= witness.rhs && witness.g <= vertex.rhs) {
          this.stats.dominanceSubsetKeySuccesses++
          return true
        }
      }
      return false
    }
    for (const witness of this.dominanceWitnesses.get(vertex.gridId) ?? []) {
      this.stats.dominanceWitnessChecks++
      yield
      if (generation !== this.generation) return false
      if (witness === vertex || witness.expandedGeneration !== generation || witness.g < witness.rhs ||
        !Number.isFinite(witness.g) || witness.g > vertex.rhs || witness.history.sites.length > vertex.history.sites.length) continue
      // Necessary set-membership filter only. Every positive still receives
      // the exact sorted subset proof; collisions can only miss a speedup.
      if ((witness.history.maskA & vertex.history.maskA) !== witness.history.maskA ||
        (witness.history.maskB & vertex.history.maskB) !== witness.history.maskB) {
        this.stats.dominanceMaskRejections++
        continue
      }
      let index = 0, subset = true
      for (const site of witness.history.sites) {
        while (index < vertex.history.sites.length && vertex.history.sites[index]! < site) {
          this.stats.dominanceSubsetChecks++
          yield
          index++
        }
        this.stats.dominanceSubsetChecks++
        yield
        if (generation !== this.generation) return false
        if (vertex.history.sites[index] !== site) { subset = false; break }
      }
      if (subset) return true
    }
    return false
  }

  private *addDominanceWitness(vertex: Vertex, generation: number): Generator<void> {
    const limit = this.problem.dominanceWitnessLimit ?? 32
    if (vertex.kind !== "grid" || limit === 0 || generation !== this.generation) return
    vertex.expandedGeneration = generation
    if (vertex.history.sites.length < 2) {
      this.stats.dominanceIndexWork++
      yield
      if (generation !== this.generation) return
      if (vertex.history.sites.length === 0) this.emptyHistoryWitnesses.set(vertex.gridId, vertex)
      else {
        let singles = this.singleHistoryWitnesses.get(vertex.gridId)
        if (!singles) { singles = new Map<number, Vertex>(); this.singleHistoryWitnesses.set(vertex.gridId, singles) }
        singles.set(vertex.history.sites[0]!, vertex)
      }
      return
    }
    const retained: Vertex[] = []
    for (const previous of this.dominanceWitnesses.get(vertex.gridId) ?? []) {
      this.stats.dominanceIndexWork++
      yield
      if (generation !== this.generation) return
      if (previous !== vertex && previous.expandedGeneration === generation) retained.push(previous)
    }
    retained.push(vertex)
    if (retained.length > limit) {
      let worst = 0
      for (let index = 1; index < retained.length; index++) {
        this.stats.dominanceIndexWork++
        yield
        const a = retained[index]!, b = retained[worst]!
        if (a.history.sites.length > b.history.sites.length ||
          a.history.sites.length === b.history.sites.length && (a.g > b.g || a.g === b.g && a.id > b.id)) worst = index
      }
      retained.splice(worst, 1)
    }
    if (generation === this.generation) this.dominanceWitnesses.set(vertex.gridId, retained)
  }

  private *relax(edge: Edge): Generator<void> {
    this.stats.predecessorChecks++
    yield
    const candidate = edge.from.g + edge.cost
    if (candidate < edge.to.rhs || (candidate === edge.to.rhs &&
      edge.id < (edge.to.parent?.id ?? Infinity))) {
      edge.to.rhs = candidate
      edge.to.parent = edge
      yield* this.touch(edge.to)
    }
  }

  private *dirtyEdges(changes: Bounds[]): Generator<DirtyOperation> {
    const seen = new Set<number>()
    for (const bounds of changes) {
      yield { kind: "region" }
      for (let x = Math.floor(Math.max(bounds.minX, this.workspaceBounds.minX) / this.spatialCellSize);
        x <= Math.floor(Math.min(bounds.maxX, this.workspaceBounds.maxX) / this.spatialCellSize); x++) {
        for (let y = Math.floor(Math.max(bounds.minY, this.workspaceBounds.minY) / this.spatialCellSize);
          y <= Math.floor(Math.min(bounds.maxY, this.workspaceBounds.maxY) / this.spatialCellSize); y++) {
          yield { kind: "cell" }
          for (const edge of this.edgeCells.get(`${x},${y}`) ?? []) {
            yield { kind: "candidate" }
            if (seen.has(edge.id)) continue
            const a = edge.from.point, b = edge.to.point
            if (Math.max(a.x, b.x) < bounds.minX || Math.min(a.x, b.x) > bounds.maxX ||
              Math.max(a.y, b.y) < bounds.minY || Math.min(a.y, b.y) > bounds.maxY) continue
            seen.add(edge.id)
            yield { kind: "edge", edge }
          }
        }
      }
    }
  }

  private *path(generation: number): Generator<void, Point[] | undefined> {
    const reversed: Point[] = []
    let cursor = this.goal
    let cost = 0
    const seen = new Set<number>()
    while (cursor !== this.source) {
      const edge = cursor.parent
      if (!edge || seen.has(cursor.id)) throw new Error("Persistent clearance predecessor chain is invalid")
      seen.add(cursor.id)
      this.stats.validationChecks++
      yield
      if (generation !== this.generation) return undefined
      const current = this.cost(edge.from.point, edge.to.point)
      if (!Number.isFinite(current) || current !== edge.cost) {
        throw new Error("Persistent clearance returned a stale or illegal edge")
      }
      cost += current
      reversed.push({ ...cursor.point })
      cursor = edge.from
    }
    reversed.push({ ...this.problem.start })
    // GLPA* can improve a previously expanded state's rhs without lowering its
    // g again during this query. Its current greedy path may therefore be less
    // expensive than the goal label, but must never exceed that certified bound.
    if (cost > this.goal.g + REGION_EPSILON * Math.max(1, cost)) {
      throw new Error("Persistent clearance predecessor costs exceed the goal label")
    }
    const path = reversed.reverse()
    const cumulative = [0]
    for (let i = 1; i < path.length; i++) {
      this.stats.validationChecks++
      yield
      if (generation !== this.generation) return undefined
      cumulative.push(cumulative[i - 1]! + this.cost(path[i - 1]!, path[i]!))
    }
    const output: Point[] = [path[0]!]
    let anchor = 0
    for (let i = 1; i < path.length;) {
      let furthest = i
      if (path[i]!.z === output.at(-1)!.z) {
        for (let j = i + 1; j < path.length && path[j]!.z === path[i]!.z; j++) {
          this.stats.simplificationChecks++
          yield
          if (generation !== this.generation) return undefined
          if (this.cost(path[anchor]!, path[j]!) <= cumulative[j]! - cumulative[anchor]! + REGION_EPSILON) {
            furthest = j
          }
        }
      }
      output.push(path[furthest]!)
      anchor = furthest
      i = furthest + 1
    }
    return output
  }

  private *repair(): Generator<void, Point[] | null> {
    while (true) {
      if (this.wakeDominance) {
        while (this.dominanceSuppressed.size) {
          const vertex = this.dominanceSuppressed.values().next().value!
          this.dominanceSuppressed.delete(vertex)
          this.stats.dominanceReactivated++
          yield* this.touch(vertex)
        }
        this.wakeDominance = false
      }
      if (this.restoreDeferred) {
        while (this.deferred.size) {
          const vertex = this.deferred.values().next().value!
          this.deferred.delete(vertex)
          yield* this.touch(vertex)
        }
        this.restoreDeferred = false
      }
      while (this.dirty.length || this.changedTargets.size) {
        if (!this.dirty.length) {
          const vertex = this.changedTargets.values().next().value!
          this.changedTargets.delete(vertex)
          yield* this.update(vertex)
          continue
        }
        const next = this.dirty[0]!.next()
        if (next.done) { this.dirty.shift(); continue }
        if (next.value.kind === "region") {
          this.stats.invalidationRegions++
          yield
          continue
        }
        if (next.value.kind === "cell") {
          this.stats.invalidationCells++
          yield
          continue
        }
        if (next.value.kind === "candidate") {
          this.stats.invalidationCandidates++
          yield
          continue
        }
        const edge = next.value.edge
        this.stats.invalidatedEdges++
        yield
        const cost = this.cost(edge.from.point, edge.to.point)
        if (cost !== edge.cost) {
          edge.cost = cost
          this.stats.changedEdges++
          this.changedTargets.add(edge.to)
        }
      }
      this.pendingChangeCount = 0
      const top = this.queue.values[0]
      const goalKey = this.key(this.goal)
      const smaller = top && (top.first < goalKey.first ||
        (top.first === goalKey.first && (top.second < goalKey.second ||
          top.second === goalKey.second && top.third < goalKey.third)))
      if (!smaller && this.goal.g === this.goal.rhs) {
        if (!Number.isFinite(this.goal.g)) return null
        const generation = this.generation
        const path = yield* this.path(generation)
        if (!path || generation !== this.generation) continue
        return path
      }
      if (!top) throw new Error("Persistent clearance has an inconsistent goal without a frontier")
      this.aboutToPop = true
      yield
      this.aboutToPop = false
      if (this.dirty.length || this.restoreDeferred || this.wakeDominance) continue
      const epoch = this.epoch
      const generation = this.generation
      this.queue.remove(top.id)
      const vertex = this.vertices[top.id]!
      this.stats.nodesPopped++
      yield
      if (epoch !== this.epoch || generation !== this.generation) {
        yield* this.touch(vertex)
        continue
      }
      if (vertex.g > vertex.rhs) {
        if (yield* this.isDominated(vertex)) {
          if (!this.dominanceSuppressed.has(vertex)) this.stats.dominanceSuppressed++
          this.dominanceSuppressed.add(vertex)
          continue
        }
        vertex.overconsistentEpoch = this.epoch
        if (!Number.isFinite(vertex.g)) this.finiteLabels++
        vertex.g = vertex.rhs
        yield* this.generate(vertex)
        for (const edge of vertex.outgoing) yield* this.relax(edge)
        yield* this.addDominanceWitness(vertex, generation)
      } else {
        if (Number.isFinite(vertex.g)) this.finiteLabels--
        vertex.g = Infinity
        yield* this.touch(vertex)
        for (const edge of vertex.outgoing) {
          this.stats.predecessorChecks++
          yield
          if (edge.to.parent === edge) yield* this.update(edge.to)
        }
      }
    }
  }
}

type StoredSearch = { fingerprint: string; revision: number; search: PersistentClearanceSearch }
type EvictionReason = "States" | "Sessions" | "History" | "Fingerprint"

/** Region-local revisions and bounded LRU retention; eviction never prunes a query. */
export class PersistentClearanceSearchStore {
  private readonly sessions = new Map<string, StoredSearch>()
  private readonly changes: Array<{ revision: number; bounds: Bounds }> = []
  private firstRevision = 0
  revision = 0
  evictions = 0
  private peakRetainedStates = 0
  private peakRetainedEdges = 0
  private readonly recentEvictions = new Map<string, EvictionReason>()
  private readonly missReasons: Record<string, number> = {}
  private readonly evictionReasons: Record<string, number> = {}
  private retiredStates = 0
  private retiredEdges = 0
  private metadataEntriesRead = 0
  private mutationJournalEntriesMoved = 0
  constructor(readonly maximumRetainedStates = 100_000, readonly maximumSessions = 4) {
    if (!Number.isSafeInteger(maximumRetainedStates) || maximumRetainedStates < 1 ||
      !Number.isSafeInteger(maximumSessions) || maximumSessions < 1) {
      throw new Error("Persistent clearance cache limits must be positive safe integers")
    }
  }

  private evict(key: string, stored: StoredSearch, reason: EvictionReason): void {
    this.sessions.delete(key)
    this.evictions++
    this.evictionReasons[reason] = (this.evictionReasons[reason] ?? 0) + 1
    this.retiredStates += stored.search.stats.retainedStates
    this.retiredEdges += stored.search.stats.retainedEdges
    this.recentEvictions.delete(key)
    this.recentEvictions.set(key, reason)
    if (this.recentEvictions.size > 4096) this.recentEvictions.delete(this.recentEvictions.keys().next().value!)
  }

  invalidate(bounds: Bounds): void {
    if (![bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(Number.isFinite) ||
      bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) {
      throw new Error("Persistent clearance invalidation requires finite ordered bounds")
    }
    this.revision++
    this.changes.push({ revision: this.revision, bounds: { ...bounds } })
    // Bound mutation history independently of the search cache. A session that
    // missed an evicted mutation is explicitly evicted too, never reused stale.
    if (this.changes.length > 4096) {
      this.mutationJournalEntriesMoved += this.changes.length - 1
      this.changes.shift()
      this.firstRevision++
      for (const [key, session] of this.sessions) {
        this.metadataEntriesRead++
        if (session.revision < this.firstRevision) {
          this.evict(key, session, "History")
        }
      }
    }
  }

  acquire(key: string, fingerprint: string, problem: PersistentClearanceProblem,
    callbacks: Omit<PersistentClearanceQuery, "changes" | "revision">): PersistentClearanceSearch {
    let stored = this.sessions.get(key)
    this.sessions.delete(key)
    let missReason: string | undefined
    if (stored && stored.fingerprint !== fingerprint) {
      this.evict(key, stored, "Fingerprint")
      stored = undefined
      missReason = "Fingerprint"
    }
    let retained = 0
    for (const entry of this.sessions.values()) {
      retained += entry.search.stats.retainedStates
      this.metadataEntriesRead++
    }
    while (this.sessions.size && (this.sessions.size >= this.maximumSessions ||
      retained + (stored?.search.stats.retainedStates ?? 0) > this.maximumRetainedStates)) {
      const oldest = this.sessions.keys().next().value!
      const entry = this.sessions.get(oldest)!
      retained -= entry.search.stats.retainedStates
      this.evict(oldest, entry, this.sessions.size >= this.maximumSessions ? "Sessions" : "States")
    }
    if (stored && stored.search.stats.retainedStates > this.maximumRetainedStates) {
      this.evict(key, stored, "States")
      stored = undefined
      missReason = "States"
    }
    if (!stored) {
      missReason = missReason ?? this.recentEvictions.get(key) ?? "Cold"
      this.missReasons[missReason] = (this.missReasons[missReason] ?? 0) + 1
      this.recentEvictions.delete(key)
      stored = { fingerprint, revision: this.revision, search: new PersistentClearanceSearch(problem) }
    }
    const changes = this.changes.slice(stored.revision - this.firstRevision)
      .map((change) => change.bounds)
    stored.search.begin({ ...callbacks, revision: this.revision, changes })
    stored.revision = this.revision
    this.sessions.set(key, stored)
    return stored.search
  }

  release(): void {
    let retained = 0
    let edges = 0
    for (const entry of this.sessions.values()) {
      this.metadataEntriesRead++
      retained += entry.search.stats.retainedStates
      edges += entry.search.stats.retainedEdges
    }
    this.peakRetainedStates = Math.max(this.peakRetainedStates, retained)
    this.peakRetainedEdges = Math.max(this.peakRetainedEdges, edges)
    while (this.sessions.size && retained > this.maximumRetainedStates) {
      const oldest = this.sessions.keys().next().value!
      const entry = this.sessions.get(oldest)!
      retained -= entry.search.stats.retainedStates
      this.evict(oldest, entry, "States")
    }
  }

  getRetentionStats(): Record<string, number> {
    let states = 0, edges = 0
    for (const entry of this.sessions.values()) {
      states += entry.search.stats.retainedStates
      edges += entry.search.stats.retainedEdges
    }
    return {
      persistentRetainedStates: states, persistentRetainedEdges: edges,
      persistentPeakRetainedStates: this.peakRetainedStates,
      persistentPeakRetainedEdges: this.peakRetainedEdges,
      persistentSessions: this.sessions.size, persistentEvictions: this.evictions,
      persistentCacheMetadataEntriesRead: this.metadataEntriesRead,
      persistentMutationJournalEntriesMoved: this.mutationJournalEntriesMoved,
      persistentRetiredStates: this.retiredStates,
      persistentRetiredEdges: this.retiredEdges,
      ...Object.fromEntries(Object.entries(this.missReasons).map(([reason, value]) => [`persistentCacheMiss${reason}`, value])),
      ...Object.fromEntries(Object.entries(this.evictionReasons).map(([reason, value]) => [`persistentEviction${reason}`, value])),
    }
  }
}

/** Work is additive; cache high-water marks stay maxima across serial regions. */
export function mergePersistentClearanceStats(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(source)) {
    if (!key.startsWith("persistent")) continue
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`Persistent repair counter ${key} must be finite and nonnegative`)
    }
    const previous = target[key]
    if (previous !== undefined && typeof previous !== "number") {
      throw new Error(`Persistent repair counter ${key} changed type`)
    }
    const prior = previous === undefined ? 0 : previous as number
    target[key] = /persistent(Maximum|Peak|Retained|Sessions)/.test(key)
      ? Math.max(prior, value) : prior + value
  }
}
