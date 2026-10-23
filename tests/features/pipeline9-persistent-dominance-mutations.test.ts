import { expect, test } from "bun:test"
import { segmentToBoundsMinDistance } from "@tscircuit/math-utils"
import { PersistentClearanceSearch, type PersistentClearanceProblem } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/PersistentClearanceSearch"
import type { Bounds, RepairRoutePoint } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/repairRegionTypes"

test("subset drill-history dominance preserves dormant labels and reactivates them on mutation", (): void => {
  const problem: PersistentClearanceProblem = {
    start: { x: 0.25, y: 0.25, z: 0 }, end: { x: 3.75, y: 2.25, z: 1 },
    bounds: { minX: 0, maxX: 4, minY: 0, maxY: 3 }, grid: 0.5,
    layerCount: 2, traceThickness: 0.1, drillSpacing: 0.4, allowLayerChanges: true,
  }
  const search = new PersistentClearanceSearch(problem)
  let obstacle: Bounds | undefined
  const clear = (a: RepairRoutePoint, b: RepairRoutePoint): boolean =>
    !obstacle || a.z !== 0 || b.z !== 0 || segmentToBoundsMinDistance(a, b, obstacle) >= 0.05
  const extraCost = (a: RepairRoutePoint, b: RepairRoutePoint): number =>
    a.z === 1 && b.z === 1 ? Math.hypot(a.x - b.x, a.y - b.y) * 0.5 : 0
  const finish = (value: PersistentClearanceSearch): void => {
    let done = false
    for (let batch = 0; batch < 10000 && !done; batch++) done = value.advance(17)
    expect(done).toBe(true)
  }
  let suppressed = 0, reactivated = 0
  for (let revision = 0; revision < 4; revision++) {
    obstacle = revision === 1 ? { minX: 1.5, maxX: 2, minY: 0, maxY: 3 } : undefined
    const query = { revision, changes: revision ? [problem.bounds] : [], clear, extraCost }
    search.begin(query)
    search.configureBudget(30000)
    finish(search)
    const fresh = new PersistentClearanceSearch({ ...problem, dominanceWitnessLimit: 0 })
    fresh.begin({ ...query, changes: [] })
    finish(fresh)
    expect(search.getSolutionCost()).toBeCloseTo(fresh.getSolutionCost(), 9)
    const path = search.getOutput()!
    expect(path.slice(1).every((point, index) => clear(path[index]!, point))).toBe(true)
    expect(path[0]).toEqual(problem.start)
    expect(path.at(-1)).toEqual(problem.end)
    const firstVia = path.find((point, index) => index > 0 && point.z !== path[index - 1]!.z)!
    if (revision === 1) expect(firstVia.x).toBeLessThan(1.5)
    else expect(firstVia.x).toBeGreaterThan(2)
    suppressed += search.stats.dominanceSuppressed
    reactivated += search.stats.dominanceReactivated
  }
  expect(suppressed).toBeGreaterThan(0)
  expect(reactivated).toBeGreaterThan(0)
  expect(search.stats.dominanceWitnessChecks).toBeGreaterThan(0)
  obstacle = { minX: 1.5, maxX: 2, minY: 0, maxY: 3 }
  search.begin({ revision: 4, changes: [problem.bounds], clear, extraCost })
  expect(search.advance(17)).toBe(false)
  obstacle = undefined
  search.begin({ revision: 5, changes: [problem.bounds], clear, extraCost })
  finish(search)
  const fresh = new PersistentClearanceSearch({ ...problem, dominanceWitnessLimit: 0 })
  fresh.begin({ revision: 5, changes: [], clear, extraCost })
  finish(fresh)
  expect(search.getSolutionCost()).toBeCloseTo(fresh.getSolutionCost(), 9)
  search.begin({ revision: 5, changes: [], clear, extraCost })
  finish(search)
  expect(search.stats.nodesPopped).toBe(0)
})
