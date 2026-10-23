import { SingleRouteCandidatePriorityQueue } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { BaseSolver } from "../BaseSolver"

export type OwnershipLiteral = { task: number; primitive: number }
export type OwnershipCutClause = {
  owners: OwnershipLiteral[]
  /** These exclusions are hypotheses of the cut, not unconditional facts. */
  exclusions: OwnershipLiteral[]
}
export type OwnershipGraphTask = {
  connectionName: string
  owner: string
  start: number
  end: number
}
export type OwnershipGraph = {
  vertices: { x: number; y: number; z: number }[]
  adjacency: { to: number; primitive: number; cost: number }[][]
}
export type OwnershipGraphPath = {
  vertices: number[]
  primitives: number[]
}
export type OwnershipGraphStats = Record<string, number>

type SearchBranch = {
  exclusions: Map<string, OwnershipLiteral>
  paths: OwnershipGraphPath[]
  owned: Set<number>[]
  nextTask: number
}
type QueueNode = {
  x: number; y: number; z: number
  g: number; h: number; f: number; parent: null; vertex: number
}
type PathSearch = {
  task: number
  queue: SingleRouteCandidatePriorityQueue<QueueNode>
  distances: Float64Array
  parents: Int32Array
  parentPrimitives: Int32Array
  closed: Uint8Array
  reasons: Map<string, OwnershipLiteral>
  hypotheses: Map<string, OwnershipLiteral>
  excluded: Map<number, OwnershipCutClause>
}

const literalKey = (literal: OwnershipLiteral): string => {
  // Task identity is essential: two same-net pair tasks may share copper, but
  // excluding an edge for one pair must not exclude it for another pair.
  const { task, primitive } = literal
  return `${task}:${primitive}`
}

/**
 * A finite geometric-model solver, not a claim that the continuous board is
 * infeasible. Only a fully exhausted connectivity search can produce a cut.
 * The cut records both occupied primitives and all exclusion hypotheses used
 * by the search. It remains valid after backtracking within this fixed model.
 */
export class SharedOwnershipGraphSolver extends BaseSolver {
  readonly learnedClauses: OwnershipCutClause[] = []
  readonly tasks: readonly OwnershipGraphTask[]
  readonly graph: OwnershipGraph
  readonly counters: OwnershipGraphStats
  paths: OwnershipGraphPath[] = []
  exhaustedFiniteModel = false
  private branch: SearchBranch | null = null
  private search: PathSearch | null = null
  private readonly pending: SearchBranch[] = []
  private readonly seenBranches = new Set<string>([""])
  private readonly clauseKeys = new Set<string>()
  private readonly pairConflicts = new Map<string, boolean>()
  private readonly fixedBlocks = new Map<string, boolean>()

  constructor(readonly params: {
    graph: OwnershipGraph
    tasks: readonly OwnershipGraphTask[]
    primitivesConflict: (left: number, right: number) => boolean
    permanentlyBlocked: (task: number, primitive: number) => boolean
    maxIterations: number
    counters?: OwnershipGraphStats
  }) {
    super()
    this.graph = params.graph
    this.tasks = params.tasks
    this.MAX_ITERATIONS = params.maxIterations
    this.counters = params.counters ?? {}
    this.stats = this.counters
    this.pending.push({ exclusions: new Map(), paths: [], owned: [], nextTask: 0 })
    this.count("ownershipGraphCandidateCount")
    this.count("ownershipGraphVertexCount", params.graph.vertices.length)
  }

  private count(key: string, amount = 1): void {
    const previous = this.counters[key]
    this.counters[key] = (previous ?? 0) + amount
    // All counters are shared with the phase wrapper, including losing or
    // budget-exhausted candidates, rather than only the eventual winner.
  }

  private isOwned(literal: OwnershipLiteral, branch: SearchBranch): boolean {
    const set = branch.owned[literal.task]
    if (!set) return false
    return set.has(literal.primitive)
    // A literal is an exact graph primitive assigned to an exact pair task.
  }

  private startSearch(): void {
    const branch = this.branch!
    const taskIndex = branch.nextTask
    const excluded = new Map<number, OwnershipCutClause>()
    for (const assumption of branch.exclusions.values()) {
      if (assumption.task !== taskIndex) continue
      excluded.set(assumption.primitive, { owners: [], exclusions: [assumption] })
    }
    for (const clause of this.learnedClauses) {
      if (!clause.exclusions.every((literal) => branch.exclusions.has(literalKey(literal)))) continue
      const remaining = clause.owners.filter((literal) => !this.isOwned(literal, branch))
      // Earlier tasks whose chosen paths omit a literal already satisfy this
      // clause. Future tasks are unknown, rather than false assignments.
      if (remaining.some((literal) => literal.task < taskIndex)) continue
      if (remaining.length === 0) {
        this.count("ownershipGraphReusedCutPruneCount")
        this.branchOnClause(clause)
        this.branch = null
        return
      }
      if (remaining.length === 1 && remaining[0]!.task === taskIndex) {
        const literal = remaining[0]!
        if (excluded.has(literal.primitive)) continue
        excluded.set(literal.primitive, {
          owners: clause.owners.filter((owner) => literalKey(owner) !== literalKey(literal)),
          exclusions: clause.exclusions,
        })
        this.count("ownershipGraphUnitPropagationCount")
      }
    }
    const task = this.tasks[taskIndex]!
    const point = this.graph.vertices[task.start]!
    const distances = new Float64Array(this.graph.vertices.length).fill(Infinity)
    distances[task.start] = 0
    this.search = {
      task: taskIndex,
      queue: new SingleRouteCandidatePriorityQueue([{ ...point, vertex: task.start, g: 0, h: 0, f: 0, parent: null }]),
      distances,
      parents: new Int32Array(this.graph.vertices.length).fill(-1),
      parentPrimitives: new Int32Array(this.graph.vertices.length).fill(-1),
      closed: new Uint8Array(this.graph.vertices.length),
      reasons: new Map(), hypotheses: new Map(), excluded,
    }
    this.count("ownershipGraphConnectivitySearchCount")
  }

  private getBlockingReason(primitive: number): OwnershipCutClause | null {
    const search = this.search!
    const branch = this.branch!
    const excluded = search.excluded.get(primitive)
    if (excluded) return excluded
    const fixedKey = `${search.task}:${primitive}`
    let fixed = this.fixedBlocks.get(fixedKey)
    if (fixed === undefined) {
      this.count("ownershipGraphFixedGeometryCheckCount")
      fixed = this.params.permanentlyBlocked(search.task, primitive)
      this.fixedBlocks.set(fixedKey, fixed)
    }
    if (fixed) return { owners: [], exclusions: [] }
    const task = this.tasks[search.task]!
    for (let ownerTask = 0; ownerTask < branch.owned.length; ownerTask++) {
      if (this.tasks[ownerTask]!.owner === task.owner) continue
      for (const occupied of branch.owned[ownerTask]!) {
        const key = primitive < occupied ? `${primitive}:${occupied}` : `${occupied}:${primitive}`
        let conflict = this.pairConflicts.get(key)
        if (conflict === undefined) {
          this.count("ownershipGraphCopperGeometryCheckCount")
          conflict = this.params.primitivesConflict(primitive, occupied)
          this.pairConflicts.set(key, conflict)
          if (conflict) this.count("ownershipGraphBinaryGeometryClauseCount")
        } else if (conflict) {
          this.count("ownershipGraphBinaryGeometryReuseCount")
        }
        if (conflict) return { owners: [{ task: ownerTask, primitive: occupied }], exclusions: [] }
      }
    }
    return null
  }

  private finishPath(vertex: number): void {
    const search = this.search!
    const vertices = [vertex]
    const primitives: number[] = []
    while (search.parents[vertex]! !== -1) {
      primitives.push(search.parentPrimitives[vertex]!)
      vertex = search.parents[vertex]!
      vertices.push(vertex)
    }
    vertices.reverse()
    primitives.reverse()
    const branch = this.branch!
    branch.paths.push({ vertices, primitives })
    branch.owned.push(new Set(primitives))
    branch.nextTask++
    this.search = null
    this.progress = Math.min(0.99, branch.nextTask / Math.max(1, this.tasks.length))
  }

  private learnExhaustedCut(): void {
    const search = this.search!
    const branch = this.branch!
    const clause: OwnershipCutClause = {
      owners: [...search.reasons.values()],
      exclusions: [...search.hypotheses.values()],
    }
    const key = JSON.stringify([
      clause.owners.map(literalKey).sort(), clause.exclusions.map(literalKey).sort(),
    ])
    if (!this.clauseKeys.has(key)) {
      this.clauseKeys.add(key)
      this.learnedClauses.push(clause)
      this.count("ownershipGraphLearnedCutCount")
      this.count("ownershipGraphLearnedCutLiteralCount", clause.owners.length)
      this.count("ownershipGraphConditionalCutCount", Number(clause.exclusions.length > 0))
    }
    // Every disabled edge out of the reachable set has a permanent geometry
    // proof, an exact ownership literal, or a hypothesis recorded above. Thus
    // at least one occupied literal must change while hypotheses remain true.
    // Branching over all such literals preserves every finite-model solution.
    this.branchOnClause(clause)
    this.count("ownershipGraphExhaustedConnectivityCount")
    this.branch = null
    this.search = null
  }

  private branchOnClause(clause: OwnershipCutClause): void {
    const branch = this.branch!
    const alternatives = [...clause.owners].sort((left, right) => left.task - right.task)
    for (const literal of alternatives) {
      const exclusions = new Map(branch.exclusions)
      exclusions.set(literalKey(literal), literal)
      const branchKey = [...exclusions.keys()].sort().join("|")
      if (this.seenBranches.has(branchKey)) continue
      this.seenBranches.add(branchKey)
      this.pending.push({
        exclusions,
        paths: branch.paths.slice(0, literal.task),
        owned: branch.owned.slice(0, literal.task),
        nextTask: literal.task,
      })
      this.count("ownershipGraphCutBranchCount")
    }
  }

  override _step(): void {
    if (!this.branch) {
      const next = this.pending.pop()
      if (!next) {
        this.failed = true
        this.exhaustedFiniteModel = true
        this.error = "The finite ownership graph has no compatible path assignment"
        this.count("ownershipGraphFiniteModelExhaustionCount")
        return
      }
      this.branch = next
      this.count("ownershipGraphBranchAttemptCount")
      this.count("ownershipGraphRetainedPrefixPathCount", next.paths.length)
    }
    if (this.branch.nextTask === this.tasks.length) {
      this.paths = this.branch.paths
      this.solved = true
      this.progress = 1
      this.count("ownershipGraphSolvedAssignmentCount")
      return
    }
    if (!this.search) {
      this.startSearch()
      if (!this.search) return
    }
    const search = this.search
    let current = search.queue.dequeue()
    while (current && search.closed[current.vertex]) current = search.queue.dequeue()
    if (!current) {
      this.learnExhaustedCut()
      return
    }
    search.closed[current.vertex] = 1
    this.count("ownershipGraphExpandedVertexCount")
    if (current.vertex === this.tasks[search.task]!.end) {
      this.finishPath(current.vertex)
      return
    }
    for (const edge of this.graph.adjacency[current.vertex]!) {
      if (search.closed[edge.to]) continue
      const reason = this.getBlockingReason(edge.primitive)
      if (reason) {
        for (const literal of reason.owners) search.reasons.set(literalKey(literal), literal)
        for (const literal of reason.exclusions) search.hypotheses.set(literalKey(literal), literal)
        continue
      }
      const distance = current.g + edge.cost
      if (distance >= search.distances[edge.to]!) continue
      search.distances[edge.to] = distance
      search.parents[edge.to] = current.vertex
      search.parentPrimitives[edge.to] = edge.primitive
      const point = this.graph.vertices[edge.to]!
      search.queue.enqueue({ ...point, vertex: edge.to, g: distance, h: 0, f: distance, parent: null })
    }
  }

  override tryFinalAcceptance(): void {
    // A work cap is unknown. Never call learnExhaustedCut here and never
    // transfer finite-graph failure to the upstream continuous router.
    if (this.solved || this.failed) return
    this.count("ownershipGraphBudgetExhaustionCount")
    this.exhaustedFiniteModel = false
  }
}
