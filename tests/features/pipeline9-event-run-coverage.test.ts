import { expect, test } from "bun:test"
import { createClearanceCorridorSearch, type ClearanceCorridorStats } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/createClearanceCorridorSearch"
import type { RepairRoutePoint } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/repairRegionTypes"

test("sparse events contract long empty runs without a portal-count cutoff", (): void => {
  let path: RepairRoutePoint[] | null | undefined
  let stats: ClearanceCorridorStats | undefined
  let nodes = 0
  const barriers = Array.from({ length: 1000 }, (_, i) => ({
    minX: 200 + i, maxX: 200.1 + i, minY: 200, maxY: 200.1, minZ: 0, maxZ: 1,
  }))
  const search = createClearanceCorridorSearch({
    bounds: { minX: 0, maxX: 100, minY: 0, maxY: 2 },
    start: { x: 0.25, y: 0.25, z: 0 }, end: { x: 98.25, y: 0.25, z: 1 },
    barriers, additionalCostSupports: [], grid: 0.5, layerCount: 2,
    wireReach: 0.15, viaReach: 0.25, drillSpacing: 0.4, traceThickness: 0.1,
    allowLayerChanges: true, maxNodes: 30000, heuristicWeight: 3,
    clear: (): boolean => true, extraCost: (): number => 0,
    finish: (result, count, reason, edges, work): void => {
      path = result
      stats = work
      nodes = count
      expect(reason).toBe("found")
    },
  })
  for (let step = 0; step < 10000 && path === undefined; step++) search.step()
  expect(path).toBeDefined()
  expect(path).not.toBeNull()
  expect(path![0]).toEqual({ x: 0.25, y: 0.25, z: 0 })
  expect(path!.at(-1)).toEqual({ x: 98.25, y: 0.25, z: 1 })
  expect(stats!.corridorIndexEntries).toBe(1001)
  expect(stats!.corridorExpandedRunSteps).toBeGreaterThan(100)
  expect(stats!.corridorEventCandidates).toBeLessThan(stats!.corridorEventQueries * 2)
  expect(stats!.corridorGeneratedNeighbors).toBeLessThanOrEqual(25 + nodes * 23)
  expect(stats!.corridorMaintenanceLimitReached).toBe(0)
  expect(nodes).toBeLessThan(30)
})
