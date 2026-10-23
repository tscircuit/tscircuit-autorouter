import { expect, test } from "bun:test"
import { createSparseClearanceEventSearch, type SparseClearanceEventStats } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/createSparseClearanceEventSearch"
import type { RepairRoutePoint } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/repairRegionTypes"

test("finite event vertices replace the interior grid and blocked descriptors never allocate Infinity labels", (): void => {
  for (const blocked of [false, true]) {
    let result: { path: RepairRoutePoint[] | null; reason: string; work: SparseClearanceEventStats } | undefined
    const start = { x: 1, y: 1, z: 0, pcb_port_id: "start" }, end = { x: 99, y: 1, z: 0, pcb_port_id: "end" }
    const search = createSparseClearanceEventSearch({
      bounds: { minX: 0, maxX: 100, minY: 0, maxY: 2 }, start, end, barriers: [], additionalCostSupports: [],
      grid: 0.001, layerCount: 1, wireReach: 0.1, viaReach: 0.2, traceThickness: 0.1, drillSpacing: 0.4,
      allowLayerChanges: false, maxNodes: 30_000, heuristicWeight: 3,
      clear: (): boolean => !blocked, extraCost: (): number => 0,
      finish: (path, _nodes, reason, _checks, work): void => { result = { path, reason, work: work as SparseClearanceEventStats } },
    })
    for (let step = 0; step < 10000 && !result; step++) search.step()
    expect(result).toBeDefined()
    expect(result!.work.corridorSparsePolicy).toBe(1)
    expect(result!.work.corridorSparseSites).toBeLessThan(100)
    expect(result!.work.corridorSparseVertices).toBeLessThan(100)
    expect(result!.work.corridorRunEdges).toBe(0)
    expect(result!.work.corridorNodesPopped).toBeLessThanOrEqual(30_000)
    expect(result!.work.corridorMaintenanceLimitReached).toBe(0)
    if (blocked) {
      expect(result!.reason).toBe("no-path")
      expect(result!.path).toBeNull()
      expect(result!.work.corridorNodesPopped).toBe(0)
      expect(result!.work.corridorRetainedStates).toBe(1)
      expect(result!.work.corridorSparseRejectedLabels).toBeGreaterThan(25)
    } else {
      expect(result!.reason).toBe("found")
      expect(result!.path).toEqual([start, end])
      expect(result!.work.corridorNodesPopped).toBe(1)
    }
  }
})
