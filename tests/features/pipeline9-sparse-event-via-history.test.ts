import { expect, test } from "bun:test"
import { createSparseClearanceEventSearch, type SparseClearanceEventStats } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/createSparseClearanceEventSearch"
import type { RepairRoutePoint } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/repairRegionTypes"

test("sparse layer events preserve exact drill-history constraints in both routing directions", (): void => {
  for (const reverse of [false, true]) for (const spacing of [1.2, 2]) {
    const a = { x: 0.25, y: 0.25, z: 0, pcb_port_id: "A" }, b = { x: 2.75, y: 0.25, z: 0, pcb_port_id: "B" }
    let path: RepairRoutePoint[] | null | undefined, stats: SparseClearanceEventStats | undefined
    const clear = (from: RepairRoutePoint, to: RepairRoutePoint): boolean => from.z !== to.z
      ? from.x === 0.75 || from.x === 2.25 : from.z === 1 || Math.max(from.x, to.x) < 1 || Math.min(from.x, to.x) > 2
    const search = createSparseClearanceEventSearch({
      bounds: { minX: 0, maxX: 3, minY: 0, maxY: 1 }, start: reverse ? b : a, end: reverse ? a : b,
      barriers: [{ minX: 1, maxX: 2, minY: 0, maxY: 1, minZ: 0, maxZ: 0 }], additionalCostSupports: [],
      grid: 0.5, layerCount: 2, wireReach: 0.05, viaReach: 0.2, traceThickness: 0.1, drillSpacing: spacing,
      allowLayerChanges: true, maxNodes: 30000, heuristicWeight: 3, clear, extraCost: (): number => 0,
      finish: (result, _nodes, _reason, _checks, work): void => { path = result; stats = work as SparseClearanceEventStats },
    })
    for (let step = 0; step < 10000 && path === undefined; step++) search.step()
    expect(path).toBeDefined()
    expect(stats!.corridorMaintenanceLimitReached).toBe(0)
    expect(stats!.corridorSparsePolicy).toBe(1)
    if (spacing === 2) { expect(path).toBeNull(); continue }
    expect(path![0]).toEqual(reverse ? b : a)
    expect(path!.at(-1)).toEqual(reverse ? a : b)
    expect(path!.slice(1).every((point, i) => clear(path![i]!, point))).toBe(true)
    const vias = path!.filter((point, i) => i > 0 && point.z !== path![i - 1]!.z)
    expect(vias).toHaveLength(2)
    expect(Math.hypot(vias[0]!.x - vias[1]!.x, vias[0]!.y - vias[1]!.y)).toBeGreaterThanOrEqual(spacing)
  }
})
