import { expect, test } from "bun:test"
import { segmentToBoundsMinDistance } from "@tscircuit/math-utils"
import { PersistentClearanceSearch, type PersistentClearanceProblem } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/PersistentClearanceSearch"
import type { Bounds, RepairRoutePoint } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/repairRegionTypes"

test("exact proper-subset keys suppress multi-site histories and invalidate witnesses without changing fresh exact route costs", (): void => {
  const problem: PersistentClearanceProblem = {
    start: { x: 0.25, y: 0.25, z: 0 }, end: { x: 5.75, y: 0.25, z: 0 },
    bounds: { minX: 0, maxX: 6, minY: 0, maxY: 1 }, grid: 0.5,
    layerCount: 2, traceThickness: 0.1, drillSpacing: 0.4, allowLayerChanges: true,
    heuristicWeight: 1,
  }
  // Alternating layer walls require four transitions. Returning from a third
  // site can be dominated by an already expanded two-site state at that XYZ.
  let middle: Bounds | undefined = { minX: 2.5, maxX: 3, minY: 0, maxY: 1 }
  const clear = (a: RepairRoutePoint, b: RepairRoutePoint): boolean => {
    const walls = [{ minX: 1, maxX: 1.5, minY: 0, maxY: 1, z: 0 },
      { minX: 4, maxX: 4.5, minY: 0, maxY: 1, z: 0 },
      ...(middle ? [{ ...middle, z: 1 }] : [])]
    return !walls.some((wall) => (a.z !== b.z || a.z === wall.z) && segmentToBoundsMinDistance(a, b, wall) < 0.05)
  }
  const extraCost = (): number => 0
  const finish = (search: PersistentClearanceSearch): void => {
    let complete = false
    for (let batch = 0; batch < 100_000 && !complete; batch++) complete = search.advance(31)
    expect(complete).toBe(true)
    expect(search.stats.nodesPopped).toBeLessThanOrEqual(30_000)
    expect(search.stats.poppedNodeLimitReached).toBe(0)
    expect(search.stats.workUnits).toBeLessThanOrEqual(search.stats.maximumMaintenanceWorkUnits)
  }
  const freshExact = (revision: number): PersistentClearanceSearch => {
    const exact = new PersistentClearanceSearch({ ...problem, dominanceWitnessLimit: 0 })
    exact.begin({ revision, changes: [], clear, extraCost })
    exact.configureBudget(30_000)
    finish(exact)
    expect(exact.stats.dominanceSubsetKeyProbes).toBe(0)
    return exact
  }
  const search = new PersistentClearanceSearch(problem)
  let successes = 0, reactivated = 0
  for (let revision = 0; revision < 4; revision++) {
    middle = revision === 1 ? { minX: 2, maxX: 3.5, minY: 0, maxY: 1 } :
      revision === 2 ? undefined : { minX: 2.5, maxX: 3, minY: 0, maxY: 1 }
    search.begin({ revision, changes: revision ? [problem.bounds] : [], clear, extraCost })
    search.configureBudget(30_000)
    finish(search)
    expect(search.getSolutionCost()).toBeCloseTo(freshExact(revision).getSolutionCost(), 9)
    const path = search.getOutput()!
    expect(path[0]).toEqual(problem.start)
    expect(path.at(-1)).toEqual(problem.end)
    expect(path.slice(1).every((point, index) => clear(path[index]!, point))).toBe(true)
    expect(search.stats.dominanceSubsetKeysGenerated).toBe(search.stats.dominanceSubsetKeyProbes)
    expect(search.stats.dominanceSubsetKeyHits).toBeGreaterThanOrEqual(search.stats.dominanceSubsetKeySuccesses)
    if (revision === 0) {
      expect(path.filter((point, index) => index > 0 && point.z !== path[index - 1]!.z)).toHaveLength(4)
      expect(search.stats.dominanceSubsetKeySuccesses).toBeGreaterThan(0)
      expect(search.stats.dominanceSubsetKeySiteChecks).toBeGreaterThan(0)
    } else expect(search.stats.changedEdges).toBeGreaterThan(0)
    successes += search.stats.dominanceSubsetKeySuccesses
    reactivated += search.stats.dominanceReactivated
  }
  expect(successes).toBeGreaterThan(0)
  expect(reactivated).toBeGreaterThan(0)
  middle = { minX: 2, maxX: 3.5, minY: 0, maxY: 1 }
  search.begin({ revision: 4, changes: [problem.bounds], clear, extraCost })
  expect(search.advance(17)).toBe(false)
  middle = { minX: 2.5, maxX: 3, minY: 0, maxY: 1 }
  search.begin({ revision: 5, changes: [problem.bounds], clear, extraCost })
  search.configureBudget(30_000)
  finish(search)
  expect(search.getSolutionCost()).toBeCloseTo(freshExact(5).getSolutionCost(), 9)
  search.begin({ revision: 5, changes: [], clear, extraCost })
  search.configureBudget(30_000)
  finish(search)
  expect(search.stats.nodesPopped).toBe(0)
})
