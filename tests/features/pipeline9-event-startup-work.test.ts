import { expect, test } from "bun:test"
import { createClearanceCorridorSearch, type ClearanceCorridorStats } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/createClearanceCorridorSearch"

test("source connector maintenance cannot consume a truthful one-pop search allowance", (): void => {
  let predicateWork = 0
  let result: { nodes: number; reason: string; stats: ClearanceCorridorStats } | undefined
  const search = createClearanceCorridorSearch({
    bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
    start: { x: 5.25, y: 5.25, z: 0 }, end: { x: 9.75, y: 9.75, z: 0 },
    barriers: [], additionalCostSupports: [], grid: 0.5, layerCount: 2,
    traceThickness: 0.1, wireReach: 0.1, viaReach: 0.2, drillSpacing: 0.4,
    allowLayerChanges: true, maxNodes: 1, heuristicWeight: 1,
    clear: (): boolean => { predicateWork += 10_000; return true },
    extraCost: (): number => 0,
    getPredicateWork: (): number => predicateWork, maximumPredicateWork: 10_000,
    finish: (_path, nodes, reason, _edges, stats): void => { result = { nodes, reason, stats } },
  })
  for (let step = 0; step < 1000 && !result; step++) search.step()
  expect(result).toBeDefined()
  expect(result!.nodes).toBe(1)
  expect(result!.reason).toBe("node-limit")
  expect(result!.stats.corridorMaintenanceLimitReached).toBe(0)
  expect(result!.stats.corridorExactEdgeCacheMisses).toBeGreaterThanOrEqual(25)
  expect(result!.stats.corridorWorkUnits).toBeLessThan(search.maximumWork)
})
