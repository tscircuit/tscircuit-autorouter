import { expect, test } from "bun:test"
import { createVisibilityCorridorSearch } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/createVisibilityCorridorSearch"

test("corridor family pops consume the same explicit search cap as destination pops", (): void => {
  const start = { x: -1, y: 0, z: 0 }, end = { x: 1, y: 0, z: 0 }
  const bounds = { minX: -2, maxX: 2, minY: -1, maxY: 1 }
  for (const maxNodes of [1, 2, 3]) {
    const input = {
      srj: { bounds, layerCount: 1, minTraceWidth: 0.1, connections: [], obstacles: [] },
      routes: [{ connectionName: "signal", traceThickness: 0.1, viaDiameter: 0.3, route: [start, end], vias: [] }],
      routeIndex: 0, start, end, bounds, traceThickness: 0.1,
      traceClearance: 0.1, viaClearance: 0.1, allowLayerChanges: false, maxNodes,
    }
    const searchStats = { nodesPopped: 0, completionReason: "no-path" as const }
    const search = createVisibilityCorridorSearch({ input, barriers: [], clear: (): boolean => true, extraCost: (): number => 0, clearsDrills: (): boolean => true, stats: searchStats })
    let result = search.step()
    while (result.status === "pending") result = search.step()
    // Preserve the archived family policy's cap/output assertions independently
    // of the production adapter, which now selects the constrained mesh.
    expect(result.status).toBe("finished")
    expect(searchStats.nodesPopped).toBe(maxNodes)
    expect(result.reason).toBe(maxNodes === 3 ? "found" : "node-limit")
    const stats = searchStats as typeof searchStats & { corridorFamilyPops: number; corridorEdgeChecks: number }
    expect(stats.corridorFamilyPops).toBe(maxNodes === 1 ? 0 : 1)
    expect(stats.corridorEdgeChecks).toBe(maxNodes === 1 ? 0 : 1)
    if (maxNodes < 3) expect(result.path).toBeNull()
    else expect(result.path).toEqual([start, end])
  }
})
