export type HopTransition = {
  from: number
  to: number
}

export type HopSearchGraph = {
  vertexCount: number
  edges: HopTransition[]
  incoming: number[][]
  outgoing: number[][]
}

export type HopSearchCounters = {
  repairedLabels: number
  reusedLabels: number
  changedTransitions: number
}

/**
 * LPA* with a zero heuristic on a finite directed hop graph. Four cost
 * components preserve the prepared router's left-associated additions.
 * No queued Candidate or ancestor pointer survives a query boundary.
 */
export class IncrementalHopSearch {
  readonly g: Float64Array
  readonly rhs: Float64Array
  readonly costs: Float64Array
  readonly counters: HopSearchCounters = {
    repairedLabels: 0,
    reusedLabels: 0,
    changedTransitions: 0,
  }
  private readonly heap: number[] = []
  private readonly positions: Int32Array
  private initialized = false

  constructor(
    readonly graph: HopSearchGraph,
    readonly source: number,
    readonly goal: number,
  ) {
    if (!Number.isInteger(source) || !Number.isInteger(goal) || source < 0 || goal < 0 || source >= graph.vertexCount || goal >= graph.vertexCount) {
      throw new Error("Invalid incremental hop endpoints")
    }
    this.g = new Float64Array(graph.vertexCount)
    this.rhs = new Float64Array(graph.vertexCount)
    this.positions = new Int32Array(graph.vertexCount)
    this.costs = new Float64Array(graph.edges.length * 4)
  }

  private less(left: number, right: number): boolean {
    const a = Math.min(this.g[left]!, this.rhs[left]!)
    const b = Math.min(this.g[right]!, this.rhs[right]!)
    // h=0 makes both LPA* key components equal. Vertex id breaks equal keys.
    if (a !== b) return a < b
    return left < right
  }

  private exchange(left: number, right: number): void {
    const a = this.heap[left]!, b = this.heap[right]!
    this.heap[left] = b
    this.heap[right] = a
    this.positions[a] = right
    this.positions[b] = left
  }

  private repairHeap(index: number): void {
    let at = index
    while (at > 0) {
      const parent = (at - 1) >>> 1
      if (!this.less(this.heap[at]!, this.heap[parent]!)) break
      this.exchange(at, parent)
      at = parent
    }
    while (at * 2 + 1 < this.heap.length) {
      let child = at * 2 + 1
      if (child + 1 < this.heap.length && this.less(this.heap[child + 1]!, this.heap[child]!)) child++
      if (!this.less(this.heap[child]!, this.heap[at]!)) break
      this.exchange(at, child)
      at = child
    }
  }

  private schedule(vertex: number): void {
    const index = this.positions[vertex]!
    if (this.g[vertex] === this.rhs[vertex]) {
      if (index === -1) return
      const last = this.heap.pop()!
      this.positions[vertex] = -1
      if (index < this.heap.length) {
        this.heap[index] = last
        this.positions[last] = index
        this.repairHeap(index)
      }
    } else if (index === -1) {
      this.positions[vertex] = this.heap.length
      this.heap.push(vertex)
      this.repairHeap(this.heap.length - 1)
    } else {
      this.repairHeap(index)
    }
  }

  private extend(value: number, edge: number): number {
    const offset = edge * 4
    return value + this.costs[offset]! + this.costs[offset + 1]! + this.costs[offset + 2]! + this.costs[offset + 3]!
  }

  private *update(vertex: number): Generator<void, void> {
    if (vertex !== this.source) {
      let best = Infinity
      for (const edge of this.graph.incoming[vertex]!) {
        best = Math.min(best, this.extend(this.g[this.graph.edges[edge]!.from]!, edge))
        yield
      }
      this.rhs[vertex] = best
    }
    this.schedule(vertex)
    yield
  }

  *initialize(costs: Float64Array): Generator<void, void> {
    if (this.initialized || costs.length !== this.costs.length) throw new Error("Invalid incremental initialization")
    for (let vertex = 0; vertex < this.graph.vertexCount; vertex++) {
      this.g[vertex] = Infinity
      this.rhs[vertex] = Infinity
      this.positions[vertex] = -1
      yield
    }
    for (let edge = 0; edge < this.graph.edges.length; edge++) {
      for (let part = 0; part < 4; part++) {
        const index = edge * 4 + part, cost = costs[index]!
        if (Number.isNaN(cost) || cost < 0) throw new Error("Nonnegative hop cost required")
        this.costs[index] = cost
      }
      yield
    }
    this.rhs[this.source] = 0
    this.schedule(this.source)
    this.initialized = true
  }

  *changeCosts(changes: Array<{ edge: number; costs: readonly number[] }>): Generator<void, void> {
    if (!this.initialized) throw new Error("Uninitialized incremental update")
    const affected = new Set<number>()
    const oldCosts = new Map<number, number[]>()
    for (const change of changes) {
      if (change.costs.length !== 4 || !this.graph.edges[change.edge]) throw new Error("Invalid changed hop")
      if (!oldCosts.has(change.edge)) oldCosts.set(change.edge, Array.from(this.costs.slice(change.edge * 4, change.edge * 4 + 4)))
      let changed = false
      for (let part = 0; part < 4; part++) {
        const cost = change.costs[part]!
        if (Number.isNaN(cost) || cost < 0) throw new Error("Nonnegative changed hop cost required")
        changed ||= this.costs[change.edge * 4 + part] !== cost
        this.costs[change.edge * 4 + part] = cost
      }
      if (changed) {
        affected.add(this.graph.edges[change.edge]!.to)
        this.counters.changedTransitions++
      }
      yield
    }
    // Tiny can contain coincident ports and therefore zero-cost cycles. Local
    // g==rhs alone would let an obsolete finite distance support itself around
    // such a cycle after its only incoming route becomes more expensive.
    // Invalidate the old tight-edge descendant closure of increased tight
    // transitions, then let LPA* repair it from still-valid outside labels.
    const invalid = new Uint8Array(this.graph.vertexCount), pending: number[] = []
    for (const [edge, old] of oldCosts) {
      const transition = this.graph.edges[edge]!, from = this.g[transition.from]!
      const oldValue = from + old[0]! + old[1]! + old[2]! + old[3]!
      if (Number.isFinite(this.g[transition.to]) && oldValue === this.g[transition.to] && this.extend(from, edge) > oldValue) pending.push(transition.to)
      yield
    }
    for (let at = 0; at < pending.length; at++) {
      const vertex = pending[at]!
      if (vertex === this.source || invalid[vertex]) continue
      invalid[vertex] = 1
      affected.add(vertex)
      for (const edge of this.graph.outgoing[vertex]!) {
        const to = this.graph.edges[edge]!.to, old = oldCosts.get(edge)
        const value = old ? this.g[vertex]! + old[0]! + old[1]! + old[2]! + old[3]! : this.extend(this.g[vertex]!, edge)
        if (Number.isFinite(this.g[to]) && value === this.g[to]) pending.push(to)
        affected.add(to)
        yield
      }
    }
    for (let vertex = 0; vertex < invalid.length; vertex++) {
      if (invalid[vertex]) {
        this.g[vertex] = Infinity
        this.counters.repairedLabels++
      }
      yield
    }
    for (const vertex of affected) yield* this.update(vertex)
  }

  *repair(): Generator<void, void> {
    if (!this.initialized) throw new Error("Uninitialized incremental repair")
    const before = this.g.slice()
    const touched = new Uint8Array(this.graph.vertexCount)
    while (this.heap.length > 0) {
      const vertex = this.heap[0]!
      if (Math.min(this.g[vertex]!, this.rhs[vertex]!) > Math.min(this.g[this.goal]!, this.rhs[this.goal]!) && this.g[this.goal] === this.rhs[this.goal]) break
      const last = this.heap.pop()!
      this.positions[vertex] = -1
      if (this.heap.length > 0) {
        this.heap[0] = last
        this.positions[last] = 0
        this.repairHeap(0)
      }
      if (this.g[vertex]! > this.rhs[vertex]!) {
        this.g[vertex] = this.rhs[vertex]!
      } else {
        this.g[vertex] = Infinity
        yield* this.update(vertex)
      }
      this.counters.repairedLabels++
      touched[vertex] = 1
      yield
      for (const edge of this.graph.outgoing[vertex]!) yield* this.update(this.graph.edges[edge]!.to)
    }
    for (let vertex = 0; vertex < before.length; vertex++) {
      if (vertex !== this.source && vertex !== this.goal && !touched[vertex] && Number.isFinite(before[vertex]) && before[vertex] === this.g[vertex] && this.g[vertex] === this.rhs[vertex]) this.counters.reusedLabels++
      yield
    }
  }

  *getPath(): Generator<void, number[] | null> {
    if (!Number.isFinite(this.g[this.goal])) return null
    const visited = new Uint8Array(this.graph.vertexCount)
    const stack = [{ vertex: this.goal, next: 0 }]
    visited[this.goal] = 1
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!
      if (frame.vertex === this.source) return stack.map((item) => item.vertex).reverse()
      const incoming = this.graph.incoming[frame.vertex]!
      if (frame.next === incoming.length) {
        stack.pop()
        yield
        continue
      }
      const edge = incoming[frame.next++]!
      const predecessor = this.graph.edges[edge]!.from
      if (!visited[predecessor] && Number.isFinite(this.g[predecessor]) && this.extend(this.g[predecessor]!, edge) === this.g[frame.vertex]) {
        visited[predecessor] = 1
        stack.push({ vertex: predecessor, next: 0 })
      }
      yield
    }
    throw new Error("Consistent incremental goal lacks a source path")
  }
}
