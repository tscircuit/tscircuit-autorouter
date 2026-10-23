import { expect, test } from "bun:test"
import { createSparseClearanceEventSearch, type SparseClearanceEventStats } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/createSparseClearanceEventSearch"
import { getClearanceCapsuleSupportOrientation } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/createClearanceCorridorSearch"

test("lazy portals complete coincident support incidence including rotated events outside physical AABBs", (): void => {
  for (const rotated of [false, true]) {
    const a = { x: 0.25, y: 0.5, z: 0 }
    const b = rotated ? { x: 0.75, y: 1, z: 0 } : { x: 0.75, y: 0.5, z: 0 }
    const radius = 0.0625, reach = 0.0625
    const r = getClearanceCapsuleSupportOrientation(a, b, radius + reach)
    const padding = 64 * Number.EPSILON * Math.max(1, Math.abs(r.x), Math.abs(r.y), r.halfWidth, r.halfHeight)
    const x = -(r.halfWidth + padding), y = -(r.halfHeight + padding)
    const start = { x: r.x + x * r.cos - y * r.sin, y: r.y + x * r.sin + y * r.cos, z: 0 }
    const end = { x: 1.8, y: 1.8, z: 0 }
    const barrier = (first: typeof a, last: typeof a): {
      a: typeof a; b: typeof a; radius: number; minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number
    } => ({ a: first, b: last, radius, minX: Math.min(first.x, last.x) - radius, maxX: Math.max(first.x, last.x) + radius,
      minY: Math.min(first.y, last.y) - radius, maxY: Math.max(first.y, last.y) + radius, minZ: 0, maxZ: 0 })
    const coincident = rotated ? b : { x: 1, y: 0.5, z: 0 }
    const barriers = [barrier(a, b), barrier(a, coincident), ...Array.from({ length: 64 }, (_, i) =>
      barrier({ x: 100 + i, y: 100, z: 0 }, { x: 100 + i, y: 101, z: 0 }))]
    if (rotated) expect(start.y).toBeLessThan(Math.min(a.y, b.y) - radius - reach)
    let stats: SparseClearanceEventStats | undefined
    const search = createSparseClearanceEventSearch({
      bounds: { minX: 0, maxX: 2, minY: 0, maxY: 2 }, start, end, barriers, additionalCostSupports: [],
      grid: 0.1, layerCount: 1, traceThickness: 0.1, wireReach: reach, viaReach: 0.2,
      drillSpacing: 0.4, allowLayerChanges: false, maxNodes: 1000, heuristicWeight: 3,
      // This checks event incidence, independently of physical feasibility;
      // capsule clearance is exercised by the separate physical-support test.
      clear: (): boolean => true, extraCost: (): number => 0,
      finish: (path, _nodes, reason, _checks, work): void => {
        expect(reason).toBe("found")
        expect(path![0]).toEqual(start)
        expect(path!.at(-1)).toEqual(end)
        stats = work as SparseClearanceEventStats
      },
    })
    for (let step = 0; step < 100000 && !stats; step++) search.step()
    expect(stats).toBeDefined()
    expect(stats!.corridorSparsePortalIncidenceMatches).toBeGreaterThanOrEqual(2)
    expect(stats!.corridorSparsePortalMaterializations).toBeLessThan(barriers.length)
    expect(stats!.corridorSparsePortalIndexEntries).toBe(barriers.length)
    expect(stats!.corridorSparseSetupCandidates).toBeLessThan(2 + 50 + 8 + 16 * barriers.length)
    expect(stats!.corridorRetainedSparsePortalIncidences).toBeGreaterThan(0)
    expect(stats!.corridorMaintenanceLimitReached).toBe(0)
  }
})
