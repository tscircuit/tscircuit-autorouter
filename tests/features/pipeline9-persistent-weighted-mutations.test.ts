import { expect, test } from "bun:test"
import { segmentToBoundsMinDistance } from "@tscircuit/math-utils"
import { PersistentClearanceSearch, type PersistentClearanceProblem } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/PersistentClearanceSearch"
import type { Bounds, RepairRoutePoint } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/repairRegionTypes"

test("weighted lifelong search repairs blocked ancestors and retains its frontier", (): void => {
  const problem: PersistentClearanceProblem = {
    start: { x: 0.1, y: 2.1, z: 0 }, end: { x: 7.9, y: 2.1, z: 0 },
    bounds: { minX: 0, maxX: 8, minY: 0, maxY: 4 },
    grid: 0.25, layerCount: 1, traceThickness: 0.1,
    drillSpacing: 0.4, allowLayerChanges: false, heuristicWeight: 3,
  }
  const search = new PersistentClearanceSearch(problem)
  let obstacles: Bounds[] = []
  let upperCost = 0
  const clear = (a: RepairRoutePoint, b: RepairRoutePoint): boolean =>
    obstacles.every((bounds) => segmentToBoundsMinDistance(a, b, bounds) >= 0.05)
  const extraCost = (a: RepairRoutePoint, b: RepairRoutePoint): number =>
    (a.y + b.y) / 2 > 2 ? Math.hypot(a.x - b.x, a.y - b.y) * upperCost : 0
  const complete = (value: PersistentClearanceSearch): void => {
    let done = false
    for (let batch = 0; batch < 10000 && !done; batch++) done = value.advance(17)
    expect(done).toBe(true)
  }
  let invalidated = 0, repaired = 0
  for (let revision = 0; revision < 8; revision++) {
    if (revision === 2) obstacles = [{ minX: 3.7, maxX: 4.3, minY: 1.2, maxY: 2.8 }]
    if (revision === 3) upperCost = 7
    if (revision === 4) obstacles = [{ minX: 3.7, maxX: 4.3, minY: 0.2, maxY: 2.8 }]
    if (revision === 5) upperCost = 0
    if (revision === 6) obstacles = []
    search.begin({ revision, changes: revision > 1 ? [problem.bounds] : [], clear, extraCost })
    search.configureBudget(30000)
    complete(search)
    const optimal = new PersistentClearanceSearch({ ...problem, heuristicWeight: 1 })
    optimal.begin({ revision, changes: [], clear, extraCost })
    complete(optimal)
    expect(search.getSolutionCost()).toBeLessThanOrEqual(3 * optimal.getSolutionCost() + 1e-6)
    const path = search.getOutput()!
    expect(path[0]).toEqual(problem.start)
    expect(path.at(-1)).toEqual(problem.end)
    expect(path.slice(1).every((point, index) => clear(path[index]!, point))).toBe(true)
    let cost = 0
    for (let index = 1; index < path.length; index++) {
      cost += Math.hypot(path[index]!.x - path[index - 1]!.x, path[index]!.y - path[index - 1]!.y)
        + extraCost(path[index - 1]!, path[index]!)
    }
    expect(cost).toBeLessThanOrEqual(search.getSolutionCost() + 1e-6)
    invalidated += search.stats.invalidatedEdges
    repaired += search.stats.changedEdges
    if (revision === 1) {
      expect(search.stats.reusedLabels).toBeGreaterThan(0)
      expect(search.stats.reusedFrontierEntries).toBeGreaterThan(0)
      expect(search.stats.nodesPopped).toBe(0)
    }
  }
  expect(invalidated).toBeGreaterThan(0)
  expect(repaired).toBeGreaterThan(0)
})
