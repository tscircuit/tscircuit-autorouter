import { expect, test } from "bun:test"
import { segmentToBoundsMinDistance } from "@tscircuit/math-utils"
import { PersistentClearanceSearchStore, type PersistentClearanceProblem } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/PersistentClearanceSearch"
import type { Bounds, RepairRoutePoint } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/repairRegionTypes"

test("budgeted search and invalidation resume without discarding frontier or accepting stale paths", (): void => {
  const problem: PersistentClearanceProblem = {
    start: { x: 0.1, y: 1.1, z: 0 }, end: { x: 3.9, y: 1.1, z: 0 },
    bounds: { minX: 0, maxX: 4, minY: 0, maxY: 3 },
    grid: 0.25, layerCount: 1, traceThickness: 0.1,
    drillSpacing: 0.4, allowLayerChanges: false,
  }
  let obstacle: Bounds | undefined
  const callbacks = {
    clear: (a: RepairRoutePoint, b: RepairRoutePoint): boolean =>
      !obstacle || segmentToBoundsMinDistance(a, b, obstacle) >= 0.05,
    extraCost: (): number => 0,
  }
  const store = new PersistentClearanceSearchStore(100_000, 2)
  const first = store.acquire("span", "same-query", problem, callbacks)
  expect(first.advance(32)).toBe(false)
  expect(first.stats.workUnits).toBe(32)
  const states = first.stats.retainedStates
  obstacle = { minX: 1.6, maxX: 2.4, minY: 0.7, maxY: 1.6 }
  store.invalidate({ minX: 1.5, maxX: 2.5, minY: 0.6, maxY: 1.7 })
  const resumed = store.acquire("span", "same-query", problem, callbacks)
  expect(resumed).toBe(first)
  expect(resumed.stats.reusedQueries).toBe(1)
  expect(resumed.stats.retainedStates).toBe(states)
  expect(resumed.advance(17)).toBe(false)
  expect(resumed.stats.workUnits).toBe(17)
  let complete = false
  for (let batch = 0; batch < 5000 && !complete; batch++) complete = resumed.advance(128)
  expect(complete).toBe(true)
  const output = resumed.getOutput()!
  expect(output.slice(1).every((point, index) => callbacks.clear(output[index]!, point))).toBe(true)
  expect(resumed.stats.invalidationCells).toBeGreaterThan(0)
  expect(resumed.stats.workUnits).toBeGreaterThan(resumed.stats.nodesPopped)
  const changed = store.acquire("span", "different-rules", problem, callbacks)
  expect(changed).not.toBe(resumed)
  expect(changed.stats.reusedQueries).toBe(0)
  const smallStore = new PersistentClearanceSearchStore(2, 1)
  const large = smallStore.acquire("span", "same-query", problem, callbacks)
  large.advance(128)
  smallStore.release()
  expect(smallStore.evictions).toBe(1)
  expect(smallStore.getRetentionStats().persistentRetainedStates).toBe(0)
})
