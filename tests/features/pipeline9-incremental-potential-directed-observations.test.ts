import { expect, test } from "bun:test"
import { IncrementalRepairWorkBudget, RetainedHardSpacePotential } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/incrementalRepair/RetainedHardSpacePotential"

test("one fresh directed rejection and any number of repeats cannot certify a native unordered edge", () => {
  const work = new IncrementalRepairWorkBudget(1000000)
  const potential = new RetainedHardSpacePotential({ nx: 8, ny: 8, layers: 1, grid: 1, minX: 0, minY: 0, end: { x: 7.5, y: 3.5, z: 0 }, allowLayerChanges: false }, work)
  potential.beginSearch()
  const before = Array.from({ length: 64 }, (_, id) => potential.heuristic(id))
  const pairs: Array<[{ x: number; y: number; z: number }, { x: number; y: number; z: number }]> = []
  for (let y = 0; y < 7; y++) for (const dy of [-1, 0, 1]) {
    if (y + dy < 0 || y + dy >= 7) continue
    const a = { x: 3.5, y: y + 0.5, z: 0 }
    const b = { x: 4.5, y: y + dy + 0.5, z: 0 }
    pairs.push([a, b])
    for (let repeat = 0; repeat < 4; repeat++) potential.observeFreshHardRejection(a, b)
  }
  potential.repair(2000)
  potential.beginSearch()
  expect(Array.from({ length: 64 }, (_, id) => potential.heuristic(id))).toEqual(before)
  expect(work.counters.bidirectionalCertificates).toBe(0)
  for (const [a, b] of pairs) potential.observeFreshHardRejection(b, a)
  potential.repair(2000)
  potential.beginSearch()
  expect(Array.from({ length: 64 }, (_, id) => potential.heuristic(id)).some((value, id) => value > before[id]! + 0.01)).toBe(true)
  expect(work.counters.bidirectionalCertificates).toBe(pairs.length)
})
