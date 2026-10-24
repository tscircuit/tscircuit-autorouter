import { expect, test } from "bun:test"
import { IncrementalRepairWorkBudget, RetainedHardSpacePotential } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/incrementalRepair/RetainedHardSpacePotential"

test("retained partial Bellman labels remain below an independent finite-graph distance oracle", () => {
  let strengthened = 0
  for (let model = 0; model < 24; model++) {
    const n = 8
    const end = { x: 7.5, y: 3.5, z: 0 }
    const work = new IncrementalRepairWorkBudget(10000000)
    const potential = new RetainedHardSpacePotential({ nx: n, ny: n, layers: 1, grid: 1, minX: 0, minY: 0, end, allowLayerChanges: false }, work)
    const blocked = new Set<string>()
    const edges: Array<[number, number, number]> = []
    potential.beginSearch()
    for (let id = 0; id < n * n; id++) potential.heuristic(id)
    for (let id = 0; id < n * n; id++) for (let other = id + 1; other < n * n; other++) {
      const a = { x: id % n + 0.5, y: Math.floor(id / n) + 0.5, z: 0 }
      const b = { x: other % n + 0.5, y: Math.floor(other / n) + 0.5, z: 0 }
      if (Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1) continue
      const wall = Math.min(a.x, b.x) < 4 && Math.max(a.x, b.x) > 4 && Math.max(a.y, b.y) < 6.5
      const randomBlock = model > 0 && (id * 37 + other * 19 + model * 11) % 29 < model % 5
      if (wall || randomBlock) {
        blocked.add(`${id},${other}`)
        potential.observeFreshHardRejection(a, b)
        potential.observeFreshHardRejection(b, a)
      } else {
        const distance = Math.hypot(a.x - b.x, a.y - b.y)
        edges.push([id, other, distance], [other, id, distance])
      }
    }
    potential.repair(2000)
    potential.beginSearch()
    const exact = Array.from({ length: n * n }, (_, id) => {
      const distance = Math.hypot(id % n + 0.5 - end.x, Math.floor(id / n) + 0.5 - end.y)
      return distance < 3 ? distance : Infinity
    })
    for (let pass = 0; pass < n * n; pass++) for (const [from, to, cost] of edges) exact[from] = Math.min(exact[from]!, cost + exact[to]!)
    for (let id = 0; id < exact.length; id++) {
      const lower = potential.heuristic(id)
      const euclidean = Math.hypot(id % n + 0.5 - end.x, Math.floor(id / n) + 0.5 - end.y)
      expect(lower).toBeLessThanOrEqual(exact[id]! + 1e-12)
      expect(lower).toBeGreaterThanOrEqual(euclidean)
      if (lower > euclidean + 0.001) strengthened++
    }
    expect(work.counters.bellmanLabelIncreases).toBeGreaterThan(0)
  }
  expect(strengthened).toBeGreaterThan(50)
})
