import { expect, test } from "bun:test"
import { SparseHistoryWitnessIndex } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/SparseHistoryWitnessIndex"

test("sparse witness candidates preserve full subset decisions across retained-bank eviction and cost decreases", () => {
  type Witness = { sites: number[]; cost: number }
  const index = new SparseHistoryWitnessIndex<Witness>()
  const retained: Witness[] = []
  const subset = (witness: Witness, history: number[], cost: number, self?: Witness): boolean =>
    witness !== self && witness.cost <= cost && witness.sites.every((site) => history.includes(site))
  let seed = 71
  const next = (): number => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0)
  let scans = 0, candidates = 0
  for (let round = 0; round < 500; round++) {
    const sites = [...new Set(Array.from({ length: 2 + next() % 7 }, () => next() % 64))].sort((a, b) => a - b)
    if (sites.length < 2) sites.push(64)
    const witness = { sites, cost: next() % 100 }
    retained.push(witness)
    index.add(witness)
    index.add(witness) // Re-expansion retains this exact object once.
    if (retained.length > 32) index.remove(retained.splice(next() % retained.length, 1)[0]!)
    if (round % 3 === 0) retained[next() % retained.length]!.cost = 0
    for (let q = 0; q < 8; q++) {
      const self = q === 0 ? retained[next() % retained.length] : undefined
      const history = self?.sites ?? [...new Set(Array.from({ length: next() % 12 }, () => next() % 64))].sort((a, b) => a - b)
      const cost = q === 1 ? 0 : next() % 100
      const selected = history.flatMap((site) => [...(index.get(site) ?? [])])
      expect(selected.every((item) => retained.includes(item))).toBe(true)
      expect(new Set(selected).size).toBe(selected.length)
      expect(selected.some((item) => subset(item, history, cost, self))).toBe(retained.some((item) => subset(item, history, cost, self)))
      scans += retained.length
      candidates += selected.length
    }
  }
  expect(candidates).toBeLessThan(scans / 2)
  for (const witness of retained) index.remove(witness)
  for (let site = 0; site <= 64; site++) expect(index.get(site)).toBeUndefined()
  expect(() => index.remove(retained[0]!)).toThrow("unretained witness")
  expect(() => index.add({ sites: [1], cost: 0 })).toThrow("multi-site history")
})
