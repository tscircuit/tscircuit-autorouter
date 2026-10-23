import { expect, test } from "bun:test"
import { createClearanceCorridorSearch, type ClearanceCorridorStats } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/createClearanceCorridorSearch"
import type { RepairRoutePoint } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/repairRegionTypes"

test("distinct drill histories share exact directed physical predicates within a fixed query", (): void => {
  const calls = new Map<string, number>()
  const clear = (a: RepairRoutePoint, b: RepairRoutePoint): boolean => {
    const key = `${a.pcb_port_id ?? "grid"}:${a.x},${a.y},${a.z}>${b.pcb_port_id ?? "grid"}:${b.x},${b.y},${b.z}`
    calls.set(key, (calls.get(key) ?? 0) + 1)
    if (a.z !== b.z) return a.x < 1 || a.x > 2
    return Math.max(a.x, b.x) < 1 || Math.min(a.x, b.x) > 2
  }
  let output: RepairRoutePoint[] | null | undefined
  let stats: ClearanceCorridorStats | undefined
  const search = createClearanceCorridorSearch({
    bounds: { minX: 0, maxX: 3, minY: 0, maxY: 1 },
    start: { x: 0.25, y: 0.25, z: 0, pcb_port_id: "start" }, end: { x: 2.75, y: 0.25, z: 0, pcb_port_id: "end" },
    barriers: [{ minX: 1, maxX: 2, minY: 0, maxY: 1, minZ: 0, maxZ: 1 }],
    additionalCostSupports: [], grid: 0.5, layerCount: 2,
    traceThickness: 0.1, wireReach: 0.05, viaReach: 0.2, drillSpacing: 0.4,
    allowLayerChanges: true, maxNodes: 5000, heuristicWeight: 1,
    clear, extraCost: (): number => 0,
    finish: (path, nodes, reason, edges, work): void => { output = path; stats = work; expect(reason).toBe("no-path") },
  })
  for (let step = 0; step < 10000 && output === undefined; step++) search.step()
  expect(output).toBeDefined()
  expect(output).toBeNull()
  expect(stats!.corridorExactEdgeCacheHits).toBeGreaterThan(0)
  expect(stats!.corridorExactEdgeCacheMisses).toBe(calls.size)
  expect([...calls.values()].every((count) => count === 1)).toBe(true)
})
