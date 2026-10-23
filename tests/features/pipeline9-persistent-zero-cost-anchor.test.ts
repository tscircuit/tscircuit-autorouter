import { expect, test } from "bun:test"
import { segmentToBoundsMinDistance } from "@tscircuit/math-utils"
import { PersistentClearanceSearch, type PersistentClearanceProblem } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/PersistentClearanceSearch"
import type { RepairRoutePoint } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/repairRegionTypes"

test("coincident source and goal grid connectors invalidate before certification, including paused mutations", (): void => {
  for (const heuristicWeight of [1, 3]) for (const dominanceWitnessLimit of [0, 32]) {
    const problem: PersistentClearanceProblem = {
      start: { x: 0.25, y: 0.25, z: 0 }, end: { x: 3.75, y: 2.25, z: 1 },
      bounds: { minX: 0, maxX: 4, minY: 0, maxY: 3 }, grid: 0.5,
      layerCount: 2, traceThickness: 0.1, drillSpacing: 0.4, allowLayerChanges: true,
      heuristicWeight, dominanceWitnessLimit,
    }
    let wall = false
    const clear = (a: RepairRoutePoint, b: RepairRoutePoint): boolean =>
      !wall || a.z !== 0 || b.z !== 0 || segmentToBoundsMinDistance(a, b,
        { minX: 1.5, maxX: 2, minY: 0, maxY: 3 }) >= 0.05
    const extraCost = (a: RepairRoutePoint, b: RepairRoutePoint): number =>
      a.z === 1 && b.z === 1 ? Math.hypot(a.x - b.x, a.y - b.y) * 0.5 : 0
    const finish = (value: PersistentClearanceSearch): void => {
      let done = false
      for (let batch = 0; batch < 10000 && !done; batch++) done = value.advance(17)
      expect(done).toBe(true)
    }
    const search = new PersistentClearanceSearch(problem)
    for (let revision = 0; revision < 3; revision++) {
      wall = revision === 1
      search.begin({ revision, changes: revision ? [problem.bounds] : [], clear, extraCost })
      search.configureBudget(30000)
      finish(search)
      expect(search.getOutput()!.slice(1).every((p, i) => clear(search.getOutput()![i]!, p))).toBe(true)
      const exact = new PersistentClearanceSearch({ ...problem, heuristicWeight: 1, dominanceWitnessLimit: 0 })
      exact.begin({ revision, changes: [], clear, extraCost })
      finish(exact)
      expect(search.getSolutionCost()).toBeLessThanOrEqual(heuristicWeight * exact.getSolutionCost() + 1e-6)
    }
    wall = true
    search.begin({ revision: 3, changes: [problem.bounds], clear, extraCost })
    expect(search.advance(17)).toBe(false)
    wall = false
    search.begin({ revision: 4, changes: [problem.bounds], clear, extraCost })
    finish(search)
    expect(search.getOutput()!.slice(1).every((p, i) => clear(search.getOutput()![i]!, p))).toBe(true)
    const coincident = new PersistentClearanceSearch({ ...problem, end: problem.start })
    coincident.begin({ revision: 0, changes: [], clear: (): boolean => true, extraCost: (): number => 0 })
    finish(coincident)
    expect(coincident.getSolutionCost()).toBe(0)
    coincident.begin({ revision: 1, changes: [problem.bounds], clear: (): boolean => false, extraCost: (): number => 0 })
    finish(coincident)
    expect(coincident.getOutput()).toBeNull()
  }
})
