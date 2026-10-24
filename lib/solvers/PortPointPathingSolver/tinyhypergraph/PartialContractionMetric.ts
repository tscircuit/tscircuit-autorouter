export type MetricEdge = { from: number; to: number; weight: number }
type Arc = { to: number; edge: number }
type Entry = { vertex: number; distance: number }

/** Undirected partial contraction hierarchy. Topology elimination is independent
 * of weights. Every fill triangle is retained as a min-plus customization
 * program. Queries use an upward Dijkstra followed by a descending sweep;
 * uncontracted vertices form an ordinary exact overlay. Distances are exact
 * for this finite metric, not for a continuous or history-dependent router. */
export class PartialContractionMetric {
  readonly edges: MetricEdge[] = []
  readonly baseEdgeIds: number[] = []
  readonly rank: Int32Array
  readonly order: number[] = []
  readonly upward: Arc[][]
  readonly triangles: Array<readonly [number, number, number]> = []
  readonly weights: Float64Array
  private readonly charge: (units?: number) => void

  constructor(vertexCount: number, input: readonly MetricEdge[], charge: (units?: number) => void) {
    this.charge = charge
    charge(vertexCount)
    const adjacency = Array.from({ length: vertexCount }, (): Map<number, number> => new Map())
    this.rank = new Int32Array(vertexCount).fill(-1)
    this.upward = Array.from({ length: vertexCount }, (): Arc[] => [])
    for (const edge of input) {
      charge()
      if (!Number.isInteger(edge.from) || !Number.isInteger(edge.to) || edge.from < 0 || edge.to < 0 ||
        edge.from >= vertexCount || edge.to >= vertexCount || !Number.isFinite(edge.weight) || edge.weight < 0) {
        throw new Error('Invalid nonnegative hierarchy metric edge')
      }
      if (edge.from === edge.to) continue
      const previous = adjacency[edge.from]!.get(edge.to)
      if (previous !== undefined) {
        this.edges[previous]!.weight = Math.min(this.edges[previous]!.weight, edge.weight)
        continue
      }
      const id = this.edges.length
      this.edges.push({ ...edge })
      this.baseEdgeIds.push(id)
      adjacency[edge.from]!.set(edge.to, id)
      adjacency[edge.to]!.set(edge.from, id)
    }
    // Bounded-degree elimination prevents quadratic fill in giant port fans.
    // Repeated passes still form a valid partial hierarchy; all remaining
    // vertices are the exact top-level overlay, never discarded.
    for (let pass = 0; pass < 3; pass++) {
      for (let vertex = 0; vertex < vertexCount; vertex++) {
        charge()
        if (this.rank[vertex] !== -1 || adjacency[vertex]!.size > 6) continue
        const neighbors = [...adjacency[vertex]!]
        this.rank[vertex] = this.order.length
        this.order.push(vertex)
        for (let i = 0; i < neighbors.length; i++) {
          const [a, left] = neighbors[i]!
          this.upward[vertex]!.push({ to: a, edge: left })
          for (let j = i + 1; j < neighbors.length; j++) {
            charge()
            const [b, right] = neighbors[j]!
            let target = adjacency[a]!.get(b)
            if (target === undefined) {
              target = this.edges.length
              this.edges.push({ from: a, to: b, weight: Infinity })
              adjacency[a]!.set(b, target)
              adjacency[b]!.set(a, target)
            }
            this.triangles.push([target, left, right])
          }
        }
        for (const [neighbor] of neighbors) {
          charge()
          adjacency[neighbor]!.delete(vertex)
        }
        adjacency[vertex]!.clear()
      }
    }
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      charge()
      if (this.rank[vertex] !== -1) continue
      this.rank[vertex] = vertexCount
      for (const [to, edge] of adjacency[vertex]!) this.upward[vertex]!.push({ to, edge })
    }
    this.weights = new Float64Array(this.edges.length)
    this.customize(this.baseEdgeIds.map((id): number => this.edges[id]!.weight))
  }

  customize(baseWeights: readonly number[]): void {
    if (baseWeights.length !== this.baseEdgeIds.length) throw new Error('Hierarchy metric shape changed')
    this.charge(this.weights.length)
    this.weights.fill(Infinity)
    for (let i = 0; i < baseWeights.length; i++) {
      this.charge()
      const value = baseWeights[i]!
      if (!Number.isFinite(value) || value < 0) throw new Error('Invalid customized hierarchy weight')
      this.weights[this.baseEdgeIds[i]!] = value
    }
    for (const [target, a, b] of this.triangles) {
      this.charge()
      this.weights[target] = Math.min(this.weights[target]!, this.weights[a]! + this.weights[b]!)
    }
  }

  distances(goals: readonly number[]): Float64Array {
    this.charge(this.rank.length)
    const distance = new Float64Array(this.rank.length).fill(Infinity)
    const heap: Entry[] = []
    const push = (entry: Entry): void => {
      this.charge()
      let index = heap.length
      heap.push(entry)
      while (index > 0) {
        this.charge()
        const parent = (index - 1) >>> 1
        if (heap[parent]!.distance <= entry.distance) break
        heap[index] = heap[parent]!
        index = parent
      }
      heap[index] = entry
    }
    for (const vertex of goals) {
      this.charge()
      if (!Number.isInteger(vertex) || vertex < 0 || vertex >= distance.length) throw new Error('Invalid hierarchy goal')
      if (distance[vertex] === 0) continue
      distance[vertex] = 0
      push({ vertex, distance: 0 })
    }
    while (heap.length) {
      this.charge()
      const current = heap[0]!, tail = heap.pop()!
      if (heap.length) {
        let index = 0
        while (index * 2 + 1 < heap.length) {
          this.charge()
          let child = index * 2 + 1
          if (child + 1 < heap.length && heap[child + 1]!.distance < heap[child]!.distance) child++
          if (heap[child]!.distance >= tail.distance) break
          heap[index] = heap[child]!
          index = child
        }
        heap[index] = tail
      }
      if (distance[current.vertex] !== current.distance) continue
      for (const arc of this.upward[current.vertex]!) {
        this.charge()
        const next = current.distance + this.weights[arc.edge]!
        if (next >= distance[arc.to]!) continue
        distance[arc.to] = next
        push({ vertex: arc.to, distance: next })
      }
    }
    for (let i = this.order.length - 1; i >= 0; i--) {
      const vertex = this.order[i]!
      for (const arc of this.upward[vertex]!) {
        this.charge()
        distance[vertex] = Math.min(distance[vertex]!, distance[arc.to]! + this.weights[arc.edge]!)
      }
    }
    return distance
  }
}
