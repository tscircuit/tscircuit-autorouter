import { expect, test } from "bun:test"
import { PersistentClearanceSearch, type PersistentClearanceProblem } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/PersistentClearanceSearch"
import type { RepairRoutePoint } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/repairRegionTypes"

test("persistent lifted states retain multiple-via drill history and reversed anchors", (): void => {
  for (const reversed of [false, true]) for (const spacing of [1.2, 2]) {
    const start = { x: 0.25, y: 0.25, z: 0, pcb_port_id: reversed ? "end" : "start" }
    const end = { x: 2.75, y: 0.25, z: 0, pcb_port_id: reversed ? "start" : "end" }
    const problem: PersistentClearanceProblem = {
      start: reversed ? end : start, end: reversed ? start : end,
      bounds: { minX: 0, maxX: 3, minY: 0, maxY: 1 },
      grid: 0.5, layerCount: 2, traceThickness: 0.1,
      drillSpacing: spacing, allowLayerChanges: true,
    }
    const clear = (a: RepairRoutePoint, b: RepairRoutePoint): boolean => {
      if (a.z !== b.z) return a.x === 0.75 || a.x === 2.25
      if (a.z === 1) return true
      return Math.max(a.x, b.x) < 1 || Math.min(a.x, b.x) > 2
    }
    const search = new PersistentClearanceSearch(problem)
    search.begin({ revision: 0, changes: [], clear, extraCost: (): number => 0 })
    let complete = false
    for (let batch = 0; batch < 2000 && !complete; batch++) complete = search.advance(128)
    expect(complete).toBe(true)
    if (spacing === 2) {
      expect(search.getOutput()).toBeNull()
      expect(search.stats.completionReason).toBe("no-path")
      continue
    }
    const path = search.getOutput()!
    expect(path[0]).toEqual(problem.start)
    expect(path.at(-1)).toEqual(problem.end)
    const vias = path.flatMap((point, index) =>
      index > 0 && point.z !== path[index - 1]!.z ? [point] : [])
    expect(vias).toHaveLength(2)
    expect(Math.hypot(vias[0]!.x - vias[1]!.x, vias[0]!.y - vias[1]!.y))
      .toBeGreaterThanOrEqual(spacing)
    expect(search.stats.historyChecks).toBeGreaterThan(0)
    expect(search.stats.retainedStates).toBeGreaterThan(24)
  }
})
