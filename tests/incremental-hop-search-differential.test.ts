import { expect, test } from "bun:test"
import { IncrementalHopSearch, type HopSearchGraph } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/IncrementalHopSearch"

test("persistent g/rhs repair agrees with fresh directed search through increases, decreases, deletion and zero cycles", (): void => {
  let seed = 19429
  const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  const drain = <T>(iterator: Generator<void, T>): T => {
    let next = iterator.next(), visits = 0
    while (!next.done) {
      if (++visits > 1_000_000) throw new Error("Nonterminating handmade graph repair")
      next = iterator.next()
    }
    return next.value
  }
  const fresh = (graph: HopSearchGraph, costs: Float64Array, source: number, goal: number): number => {
    const g = new Float64Array(graph.vertexCount).fill(Infinity), closed = new Uint8Array(graph.vertexCount)
    g[source] = 0
    for (let step = 0; step < graph.vertexCount; step++) {
      let at = -1
      for (let vertex = 0; vertex < graph.vertexCount; vertex++) if (!closed[vertex] && (at === -1 || g[vertex]! < g[at]!)) at = vertex
      if (at === -1 || !Number.isFinite(g[at])) break
      closed[at] = 1
      for (const edge of graph.outgoing[at]!) {
        const offset = edge * 4, next = graph.edges[edge]!.to
        const value = g[at]! + costs[offset]! + costs[offset + 1]! + costs[offset + 2]! + costs[offset + 3]!
        if (value < g[next]!) g[next] = value
      }
    }
    return g[goal]!
  }
  for (let sample = 0; sample < 100; sample++) {
    const size = 4 + Math.floor(random() * 13)
    const graph: HopSearchGraph = { vertexCount: size, edges: [], incoming: Array.from({ length: size }, () => []), outgoing: Array.from({ length: size }, () => []) }
    for (let from = 0; from < size; from++) for (let to = 0; to < size; to++) {
      if (from === to || (random() > 0.2 && to !== from + 1)) continue
      const edge = graph.edges.length
      graph.edges.push({ from, to }); graph.outgoing[from]!.push(edge); graph.incoming[to]!.push(edge)
    }
    const costs = new Float64Array(graph.edges.length * 4)
    for (let edge = 0; edge < graph.edges.length; edge++) costs[edge * 4] = Math.floor(random() * 8)
    const search = new IncrementalHopSearch(graph, 0, size - 1)
    drain(search.initialize(costs))
    for (let round = 0; round < 20; round++) {
      const changes: Array<{ edge: number; costs: number[] }> = []
      if (round > 0) for (let update = 0; update < 3; update++) {
        const edge = Math.floor(random() * graph.edges.length), value = random() < 0.2 ? Infinity : Math.floor(random() * 8)
        costs[edge * 4] = value
        changes.push({ edge, costs: [value, 0, 0, 0] })
      }
      drain(search.changeCosts(changes)); drain(search.repair())
      expect(search.g[size - 1]).toBe(fresh(graph, costs, 0, size - 1))
      const path = drain(search.getPath())
      if (!Number.isFinite(search.g[size - 1])) expect(path).toBeNull()
      else {
        expect(path?.[0]).toBe(0); expect(path?.at(-1)).toBe(size - 1)
        expect(new Set(path).size).toBe(path!.length)
      }
    }
  }
})
