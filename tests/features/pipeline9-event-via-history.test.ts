import { expect, test } from "bun:test"
import { createClearanceCorridorSearch } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/createClearanceCorridorSearch"
import type { RepairRoutePoint } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/repairRegionTypes"

test("event search retains exact drill histories with reversed anchors and multiple vias", (): void => {
  for (const reversed of [false, true]) for (const spacing of [1.2, 2]) {
    const start = { x: 0.25, y: 0.25, z: 0, pcb_port_id: "start" }
    const end = { x: 2.75, y: 0.25, z: 0, pcb_port_id: "end" }
    let path: RepairRoutePoint[] | null | undefined
    const clear = (a: RepairRoutePoint, b: RepairRoutePoint): boolean => {
      if (a.z !== b.z) return a.x === 0.75 || a.x === 2.25
      if (a.z === 1) return true
      return Math.max(a.x, b.x) < 1 || Math.min(a.x, b.x) > 2
    }
    const search = createClearanceCorridorSearch({
      bounds: { minX: 0, maxX: 3, minY: 0, maxY: 1 },
      start: reversed ? end : start, end: reversed ? start : end,
      barriers: [{ minX: 1, maxX: 2, minY: 0, maxY: 1, minZ: 0, maxZ: 0 }],
      additionalCostSupports: [], grid: 0.5, layerCount: 2,
      wireReach: 0.05, viaReach: 0.2, drillSpacing: spacing, traceThickness: 0.1,
      allowLayerChanges: true, maxNodes: 30000, heuristicWeight: 3,
      clear, extraCost: (): number => 0,
      finish: (result): void => { path = result },
    })
    for (let step = 0; step < 10000 && path === undefined; step++) search.step()
    expect(path).toBeDefined()
    if (spacing === 2) { expect(path).toBeNull(); continue }
    expect(path![0]).toEqual(reversed ? end : start)
    expect(path!.at(-1)).toEqual(reversed ? start : end)
    expect(path!.slice(1).every((p, i) => clear(path![i]!, p))).toBe(true)
    const vias = path!.filter((p, i) => i > 0 && p.z !== path![i - 1]!.z)
    expect(vias).toHaveLength(2)
    expect(Math.hypot(vias[0]!.x - vias[1]!.x, vias[0]!.y - vias[1]!.y)).toBeGreaterThanOrEqual(spacing)
  }
})
