import { expect, test } from "bun:test"
import { IncrementalRepairWorkBudget, RetainedHardSpacePotential } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/incrementalRepair/RetainedHardSpacePotential"

test("native queue heuristics stay frozen within a search while the next search inherits Bellman work", () => {
  const work = new IncrementalRepairWorkBudget(1000000)
  const potential = new RetainedHardSpacePotential({ nx: 8, ny: 8, layers: 1, grid: 1, minX: 0, minY: 0, end: { x: 7.5, y: 3.5, z: 0 }, allowLayerChanges: false }, work)
  potential.beginSearch()
  const before = Array.from({ length: 64 }, (_, id) => potential.heuristic(id))
  for (let y = 0; y < 7; y++) for (const dy of [-1, 0, 1]) {
    if (y + dy < 0 || y + dy >= 7) continue
    potential.observeFreshHardRejection({ x: 3.5, y: y + 0.5, z: 0 }, { x: 4.5, y: y + dy + 0.5, z: 0 })
    potential.observeFreshHardRejection({ x: 4.5, y: y + dy + 0.5, z: 0 }, { x: 3.5, y: y + 0.5, z: 0 })
  }
  potential.repair(1000)
  expect(Array.from({ length: 64 }, (_, id) => potential.heuristic(id))).toEqual(before)
  potential.beginSearch()
  const after = Array.from({ length: 64 }, (_, id) => potential.heuristic(id))
  expect(after.some((value, id) => value > before[id]! + 0.01)).toBe(true)
  expect(work.counters.directedRejectionInsertions).toBeGreaterThan(0)
  expect(work.counters.strongerHeuristicReads).toBeGreaterThan(0)
})
