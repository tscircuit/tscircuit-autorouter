import { expect, test } from "bun:test"
import { createSparseClearanceEventSearch, type SparseClearanceEventStats } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/createSparseClearanceEventSearch"

test("long event edges integrate native-size congestion primitives instead of charging one long-segment penalty", (): void => {
  let stats: SparseClearanceEventStats | undefined, largestPrimitive = 0
  const bounds = { minX: 0, maxX: 11, minY: 0, maxY: 1 }
  const search = createSparseClearanceEventSearch({
    bounds, start: { x: 0.5, y: 0.5, z: 0 }, end: { x: 10.5, y: 0.5, z: 0 }, barriers: [],
    additionalCostSupports: [{ ...bounds, minZ: 0, maxZ: 0 }], grid: 1, layerCount: 1,
    wireReach: 0.05, viaReach: 0.2, traceThickness: 0.1, drillSpacing: 0.4,
    allowLayerChanges: false, maxNodes: 30000, heuristicWeight: 3,
    clear: (): boolean => true,
    extraCost: (a, b): number => { const distance = Math.hypot(a.x - b.x, a.y - b.y); largestPrimitive = Math.max(largestPrimitive, distance); return distance ** 2 },
    finish: (path, _nodes, reason, _checks, work): void => { expect(path).not.toBeNull(); expect(reason).toBe("found"); stats = work as SparseClearanceEventStats },
  })
  for (let step = 0; step < 10000 && !stats; step++) search.step()
  expect(stats).toBeDefined()
  expect(stats!.corridorSparseSolutionCost).toBe(20)
  expect(largestPrimitive).toBeLessThanOrEqual(1)
  expect(stats!.corridorSparseCostPieces).toBeGreaterThanOrEqual(10)
  expect(stats!.corridorSparseCostCallbacks).toBe(stats!.corridorSparseCostPieces)
  expect(stats!.corridorMaintenanceLimitReached).toBe(0)
})
