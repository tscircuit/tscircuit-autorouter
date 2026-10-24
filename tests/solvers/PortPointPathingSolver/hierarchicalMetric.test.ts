import { expect, test } from 'bun:test'
import { PartialContractionMetric, type MetricEdge } from '../../../lib/solvers/PortPointPathingSolver/tinyhypergraph/PartialContractionMetric'

test('partial hierarchy and repeated min-plus customization equal independent shortest path oracle', (): void => {
  let seed = 19291, assertions = 0, work = 0
  const next = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
  for (let trial = 0; trial < 250; trial++) {
    const n = 3 + next() % 30, edges: MetricEdge[] = []
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      if (next() % 5 !== 0) continue
      edges.push({ from: a, to: b, weight: next() % 12 })
    }
    const model = new PartialContractionMetric(n, edges, (units = 1): void => { work += units })
    for (let metric = 0; metric < 3; metric++) {
      const weights = model.baseEdgeIds.map((id): number => metric === 0 ? model.edges[id]!.weight : next() % 50)
      model.customize(weights)
      const goals = [...new Set([next() % n, next() % n])]
      const expected = Array(n).fill(Infinity) as number[]
      for (const goal of goals) expected[goal] = 0
      for (let pass = 0; pass < n; pass++) {
        let changed = false
        for (let i = 0; i < model.baseEdgeIds.length; i++) {
          const edge = model.edges[model.baseEdgeIds[i]!]!, weight = weights[i]!
          if (expected[edge.to]! > expected[edge.from]! + weight) { expected[edge.to] = expected[edge.from]! + weight; changed = true }
          if (expected[edge.from]! > expected[edge.to]! + weight) { expected[edge.from] = expected[edge.to]! + weight; changed = true }
        }
        if (!changed) break
      }
      const actual = model.distances(goals)
      for (let vertex = 0; vertex < n; vertex++) { expect(actual[vertex]).toBe(expected[vertex]); assertions++ }
    }
  }
  expect(assertions).toBeGreaterThan(10_000)
  expect(work).toBeGreaterThan(0)
})
