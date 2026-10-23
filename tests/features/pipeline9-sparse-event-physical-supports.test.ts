import { expect, test } from "bun:test"
import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import { createSparseClearanceEventSearch, type SparseClearanceEventStats } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/createSparseClearanceEventSearch"
import type { RepairRoutePoint } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/repairRegionTypes"

test("lazy support-boundary intervals route around actual copper capsules without interior grid successors", (): void => {
  let seed = 73451
  const random = (): number => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 0x100000000 }
  for (let sample = 0; sample < 32; sample++) {
    const barriers = Array.from({ length: 4 }, () => {
      const a = { x: 1 + 2 * random(), y: 1 + 2 * random(), z: 0 }, b = { x: 1 + 2 * random(), y: 1 + 2 * random(), z: 0 }, radius = 0.05 + 0.1 * random()
      return { a, b, radius, minX: Math.min(a.x, b.x) - radius, maxX: Math.max(a.x, b.x) + radius,
        minY: Math.min(a.y, b.y) - radius, maxY: Math.max(a.y, b.y) + radius, minZ: 0, maxZ: 0 }
    })
    const start = { x: sample & 1 ? 3.75 : 0.25, y: sample & 2 ? 3.75 : 0.25, z: 0 }, end = { x: 4 - start.x, y: 4 - start.y, z: 0 }
    const clear = (a: RepairRoutePoint, b: RepairRoutePoint): boolean => barriers.every((barrier) => segmentToSegmentMinDistance(a, b, barrier.a, barrier.b) >= barrier.radius + 0.1 - 1e-10)
    let path: RepairRoutePoint[] | null | undefined, stats: SparseClearanceEventStats | undefined
    const search = createSparseClearanceEventSearch({
      bounds: { minX: 0, maxX: 4, minY: 0, maxY: 4 }, start, end, barriers, additionalCostSupports: [], grid: 0.05,
      layerCount: 1, traceThickness: 0.1, wireReach: 0.1, viaReach: 0.2, drillSpacing: 0.4,
      allowLayerChanges: false, maxNodes: 5000, heuristicWeight: 3, clear, extraCost: (): number => 0,
      finish: (result, _nodes, reason, _checks, work): void => { path = result; stats = work as SparseClearanceEventStats; expect(reason).toBe("found") },
    })
    for (let step = 0; step < 100000 && path === undefined; step++) search.step()
    expect(path).toBeDefined()
    expect(path).not.toBeNull()
    expect(path![0]).toEqual(start)
    expect(path!.at(-1)).toEqual(end)
    expect(path!.slice(1).every((point, i) => clear(path![i]!, point))).toBe(true)
    expect(stats!.corridorSparsePolicy).toBe(1)
    expect(stats!.corridorSparseSites).toBeLessThan(200)
    expect(stats!.corridorSparseBoundaryReferences).toBeGreaterThan(0)
    expect(stats!.corridorMaintenanceLimitReached).toBe(0)
  }
})
