import { SingleRouteCandidatePriorityQueue } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { BaseSolver } from "../BaseSolver"
import { FiniteFrontierDecisionDiagramSolver, type FrontierChoice, type FrontierStats, type FrontierTask } from "./FiniteFrontierDecisionDiagramSolver"

export type { FrontierStats } from "./FiniteFrontierDecisionDiagramSolver"
export type FrontierGraph = {
  vertices: { x: number; y: number; z: number }[]
  adjacency: { to: number; primitive: number; cost: number }[][]
}
export type FrontierPath = { vertices: number[]; primitives: number[] }
type QueueNode = { x: number; y: number; z: number; g: number; h: number; f: number; parent: null; vertex: number }
type StaticProfile = { preferredLayer: number | null; axis: "x" | "y" | null; sign: number }
type DomainSearch = {
  task: number
  queue: SingleRouteCandidatePriorityQueue<QueueNode>
  distance: Float64Array
  parent: Int32Array
  parentPrimitive: Int32Array
  closed: Uint8Array
}

/**
 * Independent, deterministic routing profiles create a finite domain for every
 * original pair. ALL domains are frozen before the decision diagram begins:
 * no prefix witness, forgotten resource or merged history generates new paths.
 * This isolates exact future-interface quotienting from adaptive path sampling.
 */
export class FrontierRouteDomainSolver extends BaseSolver {
  readonly graph: FrontierGraph
  readonly tasks: readonly FrontierTask[]
  readonly counters: FrontierStats
  readonly domains: FrontierChoice[][]
  readonly profiles: readonly StaticProfile[]
  paths: FrontierPath[] = []
  diagram: FiniteFrontierDecisionDiagramSolver | null = null
  private readonly fixedBlocks = new Map<string, boolean>()
  private readonly geometryConflicts = new Map<string, boolean>()
  private readonly choiceKeys: Set<string>[]
  private search: DomainSearch | null = null
  private taskIndex = 0
  private profileIndex = 0
  private readonly bounds: { minX: number; maxX: number; minY: number; maxY: number }
  private readonly heuristicScale: number

  constructor(readonly params: {
    graph: FrontierGraph
    tasks: readonly FrontierTask[]
    primitivesConflict: (left: number, right: number) => boolean
    permanentlyBlocked: (task: number, primitive: number) => boolean
    ownerIndependentConflicts?: {
      primitiveIds: ReadonlySet<number>
      conflict: (left: number, right: number) => boolean
    }
    maxIterations: number
    maxStatesPerLayer?: number
    counters?: FrontierStats
  }) {
    super()
    this.graph = params.graph
    this.tasks = Object.freeze(params.tasks.map((task) => Object.freeze({ ...task })))
    this.counters = params.counters ?? {}
    this.stats = this.counters
    this.MAX_ITERATIONS = params.maxIterations
    this.domains = params.tasks.map(() => [])
    this.choiceKeys = params.tasks.map(() => new Set())
    const layers = [...new Set(this.graph.vertices.map((point) => point.z))].sort((a, b) => a - b)
    this.profiles = [
      { preferredLayer: null, axis: null, sign: 0 },
      ...layers.map((z): StaticProfile => ({ preferredLayer: z, axis: null, sign: 0 })),
      { preferredLayer: null, axis: "x", sign: -1 }, { preferredLayer: null, axis: "x", sign: 1 },
      { preferredLayer: null, axis: "y", sign: -1 }, { preferredLayer: null, axis: "y", sign: 1 },
    ]
    this.bounds = {
      minX: Math.min(...this.graph.vertices.map((point) => point.x)), maxX: Math.max(...this.graph.vertices.map((point) => point.x)),
      minY: Math.min(...this.graph.vertices.map((point) => point.y)), maxY: Math.max(...this.graph.vertices.map((point) => point.y)),
    }
    this.heuristicScale = this.graph.adjacency.reduce((scale, edges, vertex) => edges.reduce((minimum, edge) => {
      const a = this.graph.vertices[vertex]!, b = this.graph.vertices[edge.to]!
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      return distance > 0 ? Math.min(minimum, edge.cost / distance) : minimum
    }, scale), 1)
    this.count("frontierInterfaceCandidateCount")
    this.count("frontierInterfaceVertexCount", this.graph.vertices.length)
  }

  private count(key: string, amount = 1): void {
    const previous = this.counters[key]
    this.counters[key] = (previous ?? 0) + amount
    // Shared numeric counters cover domain construction, losing candidates,
    // exact diagram work and unknown cap exits at the ordinary phase wrapper.
  }

  private initializeDomainSearch(): void {
    const task = this.tasks[this.taskIndex]!
    const start = this.graph.vertices[task.start]!
    const end = this.graph.vertices[task.end]!
    const heuristic = this.heuristicScale * Math.hypot(start.x - end.x, start.y - end.y)
    const distance = new Float64Array(this.graph.vertices.length).fill(Infinity)
    distance[task.start] = 0
    this.search = {
      task: this.taskIndex, distance,
      parent: new Int32Array(this.graph.vertices.length).fill(-1),
      parentPrimitive: new Int32Array(this.graph.vertices.length).fill(-1),
      closed: new Uint8Array(this.graph.vertices.length),
      queue: new SingleRouteCandidatePriorityQueue([{ ...start, vertex: task.start, g: 0, h: heuristic, f: heuristic, parent: null }]),
    }
    this.count("frontierInterfaceDomainQueryCount")
  }

  private conflicts(left: number, right: number, sameOwner: boolean): boolean {
    const independent = this.params.ownerIndependentConflicts
    if (independent?.primitiveIds.has(left) && independent.primitiveIds.has(right)) {
      const key = left < right ? `drill:${left}:${right}` : `drill:${right}:${left}`
      let conflict = this.geometryConflicts.get(key)
      if (conflict === undefined) {
        this.count("frontierInterfaceDrillGeometryCheckCount")
        conflict = independent.conflict(left, right)
        this.geometryConflicts.set(key, conflict)
      }
      if (conflict) return true
    }
    if (sameOwner) return false
    const key = left < right ? `copper:${left}:${right}` : `copper:${right}:${left}`
    let conflict = this.geometryConflicts.get(key)
    if (conflict === undefined) {
      this.count("frontierInterfaceCopperGeometryCheckCount")
      conflict = this.params.primitivesConflict(left, right)
      this.geometryConflicts.set(key, conflict)
    }
    return conflict
  }

  private finishDomainPath(vertex: number): void {
    const search = this.search!
    const vertices = [vertex], primitives: number[] = []
    let cost = 0
    while (search.parent[vertex]! !== -1) {
      const previous = search.parent[vertex]!, primitive = search.parentPrimitive[vertex]!
      cost += this.graph.adjacency[previous]!.find((edge) => edge.to === vertex && edge.primitive === primitive)!.cost
      vertex = previous
      vertices.push(vertex)
      primitives.push(primitive)
    }
    vertices.reverse()
    primitives.reverse()
    const key = primitives.join(",")
    const resources = [...new Set(primitives)]
    let invalidDrills = false
    for (let i = 0; i < resources.length; i++) for (let j = i + 1; j < resources.length; j++) {
      if (this.conflicts(resources[i]!, resources[j]!, true)) invalidDrills = true
    }
    if (invalidDrills) {
      this.count("frontierInterfaceInvalidSelfDrillChoiceCount")
    } else if (this.choiceKeys[this.taskIndex]!.has(key)) {
      this.count("frontierInterfaceDuplicateDomainChoiceCount")
    } else {
      this.choiceKeys[this.taskIndex]!.add(key)
      this.domains[this.taskIndex]!.push(Object.freeze({ key, cost, vertices: Object.freeze(vertices), primitives: Object.freeze(primitives) }))
      this.count("frontierInterfaceGeneratedDomainChoiceCount")
      this.counters.frontierInterfaceMaxChoicesPerTask = Math.max(this.counters.frontierInterfaceMaxChoicesPerTask ?? 0, this.domains[this.taskIndex]!.length)
    }
    this.advanceProfile()
  }

  private advanceProfile(): void {
    this.search = null
    this.profileIndex++
    if (this.profileIndex < this.profiles.length) return
    this.profileIndex = 0
    this.taskIndex++
    if (this.taskIndex !== this.tasks.length) return
    for (const domain of this.domains) Object.freeze(domain)
    Object.freeze(this.domains)
    this.diagram = new FiniteFrontierDecisionDiagramSolver({
      tasks: this.tasks, domains: this.domains,
      maxIterations: this.MAX_ITERATIONS,
      maxStatesPerLayer: this.params.maxStatesPerLayer ?? 4096,
      counters: this.counters,
      compatible: (leftTask, leftChoice, rightTask, rightChoice): boolean => {
        const sameOwner = this.tasks[leftTask]!.owner === this.tasks[rightTask]!.owner
        const left = this.domains[leftTask]![leftChoice]!, right = this.domains[rightTask]![rightChoice]!
        for (const a of left.primitives) for (const b of right.primitives) {
          if (this.conflicts(a, b, sameOwner)) return false
        }
        return true
      },
    })
    this.activeSubSolver = this.diagram
    this.count("frontierInterfaceFrozenDomainActivationCount")
  }

  private stepDomainSearch(): void {
    if (!this.search) this.initializeDomainSearch()
    const search = this.search!
    let current = search.queue.dequeue()
    while (current && search.closed[current.vertex]) current = search.queue.dequeue()
    if (!current) {
      this.count("frontierInterfaceDomainQueryExhaustionCount")
      this.advanceProfile()
      return
    }
    search.closed[current.vertex] = 1
    this.count("frontierInterfaceDomainExpandedVertexCount")
    if (current.vertex === this.tasks[this.taskIndex]!.end) { this.finishDomainPath(current.vertex); return }
    const profile = this.profiles[this.profileIndex]!
    const start = this.graph.vertices[current.vertex]!
    for (const edge of this.graph.adjacency[current.vertex]!) {
      if (search.closed[edge.to]) continue
      const fixedKey = `${this.taskIndex}:${edge.primitive}`
      let blocked = this.fixedBlocks.get(fixedKey)
      if (blocked === undefined) {
        this.count("frontierInterfaceFixedGeometryCheckCount")
        blocked = this.params.permanentlyBlocked(this.taskIndex, edge.primitive)
        this.fixedBlocks.set(fixedKey, blocked)
      }
      if (blocked) continue
      const end = this.graph.vertices[edge.to]!
      let penalty = 1
      if (start.z === end.z && profile.preferredLayer !== null && start.z !== profile.preferredLayer) penalty *= 16
      if (start.z === end.z && profile.axis !== null) {
        const minimum = profile.axis === "x" ? this.bounds.minX : this.bounds.minY
        const maximum = profile.axis === "x" ? this.bounds.maxX : this.bounds.maxY
        const midpoint = (start[profile.axis] + end[profile.axis]) / 2
        const position = maximum === minimum ? 0.5 : (midpoint - minimum) / (maximum - minimum)
        penalty *= 1 + 4 * (profile.sign < 0 ? position : 1 - position)
      }
      const distance = current.g + edge.cost * penalty
      if (distance >= search.distance[edge.to]!) continue
      search.distance[edge.to] = distance
      search.parent[edge.to] = current.vertex
      search.parentPrimitive[edge.to] = edge.primitive
      const target = this.graph.vertices[this.tasks[this.taskIndex]!.end]!
      const heuristic = this.heuristicScale * Math.hypot(end.x - target.x, end.y - target.y)
      search.queue.enqueue({ ...end, vertex: edge.to, g: distance, h: heuristic, f: distance + heuristic, parent: null })
    }
    this.progress = Math.min(0.79, (this.taskIndex + this.profileIndex / this.profiles.length) / Math.max(1, this.tasks.length) * 0.8)
  }

  override _step(): void {
    if (!this.diagram) { this.stepDomainSearch(); return }
    this.diagram.step()
    this.progress = 0.8 + 0.2 * this.diagram.progress
    if (this.diagram.failed) { this.failed = true; this.error = this.diagram.error; return }
    if (!this.diagram.solved) return
    this.paths = this.diagram.chosenIndices.map((choice, task) => ({
      vertices: [...this.domains[task]![choice]!.vertices], primitives: [...this.domains[task]![choice]!.primitives],
    }))
    this.solved = true
    this.progress = 1
  }

  override tryFinalAcceptance(): void {
    if (this.solved || this.failed) return
    this.count("frontierInterfaceBudgetExhaustionCount")
    // Static profile enumeration and exact interface DP share one work cap.
    // Neither missing profiles nor a partial diagram imply board infeasibility.
  }
}
