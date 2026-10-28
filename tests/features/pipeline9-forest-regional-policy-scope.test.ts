import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("owned pipelines select native regional routing only when forest construction emits actual copper", (): void => {
  const input: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 }, obstacles: [], connections: [
      { name: "forest", pointsToConnect: [{ x: -2, y: 0, layer: "top", pointId: "a" },
        { x: 0, y: 0, layer: "top", pointId: "b" }, { x: 2, y: 0, layer: "top", pointId: "c" }] },
      { name: "native", pointsToConnect: [{ x: -2, y: 2, layer: "top", pointId: "d" },
        { x: 2, y: 2, layer: "top", pointId: "e" }] },
    ] }
  const userPreload = { type: "pcb_trace" as const, pcb_trace_id: "owned-user-copper", connection_name: "forest",
    connectsTo: ["a", "b"], route: [{ route_type: "wire" as const, x: -2, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire" as const, x: 0, y: 0, width: 0.1, layer: "top" }] }
  const cases: Array<[SimpleRouteJson, boolean, number]> = [
    [input, true, 2], [input, false, 0],
    [{ ...input, connections: [input.connections[1]!] }, true, 0],
    [{ ...input, traces: [userPreload] }, true, 0],
  ]
  for (const [scenario, forestEnabled, expectedBranches] of cases) {
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(scenario), {
      usePhysicalNetForest: forestEnabled, cacheProvider: null, effort: 0.1,
    })
    solver.solveUntilPhase("highDensityRouteSolver")
    if (!solver.highDensityRouteSolver) solver.step()
    expect(solver.failed, solver.error ?? "").toBe(false)
    expect(solver.physicalNetForestSolver!.branches).toHaveLength(expectedBranches)
    expect(solver.highDensityRouteSolver!.useNativeRegionalRouting).toBe(expectedBranches > 0)
  }
})
