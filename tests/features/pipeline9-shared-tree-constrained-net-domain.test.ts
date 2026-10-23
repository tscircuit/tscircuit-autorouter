import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"

test("default serialization keeps an entire constrained multipoint canonical net as original independent logical paths", (): void => {
  const input: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1,
    bounds: { minX: -4, maxX: 34, minY: -4, maxY: 30 },
    obstacles: [{ type: "rect", center: { x: 10, y: 10 }, width: 2, height: 2, layers: ["top", "bottom"], connectedTo: [] }],
    connections: [{ name: "bus", pointsToConnect: [
      { x: 0, y: 0, layer: "top", pcb_port_id: "A" }, { x: 30, y: 0, layer: "top", pcb_port_id: "B" }, { x: 19, y: 25, layer: "top", pcb_port_id: "C" },
    ] }], buses: [{ busId: "declared_path", connectionNames: ["bus"], maxLengthSkew: 0.1, traceWidth: 0.2 }] }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(input), { cacheProvider: null })
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBe(true)
  expect(solver.failed).toBe(false)
  const original = solver.srjWithPointPairs!.connections
  const physical = solver.getRoutingConnections()
  expect(original).toHaveLength(2)
  expect(physical).toHaveLength(original.length)
  for (const demand of original) {
    const preserved = physical.find((connection) => connection.name === demand.name)!
    expect(preserved).toMatchObject(demand)
    expect(preserved.electricalBranch!.nativeLogicalPath).toBe(true)
    expect(preserved.nominalTraceWidth).toBe(0.2)
  }
  const metrics: Record<string, unknown> = solver.portPointPathingSolver!.getSolveGraphBenchmarkMetrics()!
  expect(metrics.electricalTreeNativePathNetCount).toBe(1)
  expect(metrics.electricalTreeNativePathDemandCount).toBe(2)
  expect(metrics.electricalTreeTargetCount).toBe(0)
  expect(metrics.electricalTreeSharedCacheReferenceCount).toBe(0)
  expect(metrics.electricalTreePhysicalBranchCount).toBe(0)
  expect(evaluateRelaxedDrc({ inputSrj: input, srjWithPointPairs: solver.srjWithPointPairs!, routedTraces: solver.getOutputSimplifiedPcbTraces() }).errors).toEqual([])
  const mixedInput: SimpleRouteJson = { ...structuredClone(input), bounds: { ...input.bounds, minY: -40 },
    connections: [...structuredClone(input.connections), { name: "unconstrained", pointsToConnect: [
      { x: 0, y: -35, layer: "top", pcb_port_id: "X" }, { x: 30, y: -35, layer: "top", pcb_port_id: "Y" }, { x: 19, y: -10, layer: "top", pcb_port_id: "Z" },
    ] }], obstacles: [...structuredClone(input.obstacles), { ...input.obstacles[0]!, center: { x: 10, y: -25 } }] }
  const mixed = new AutoroutingPipelineSolver9_PreloadedTraceGraph(mixedInput, { cacheProvider: null })
  mixed.solve()
  expect(mixed.solved, mixed.error ?? "").toBe(true)
  const mixedConnections = mixed.getRoutingConnections()
  expect(mixedConnections.filter((connection) => connection.electricalBranch!.nativeLogicalPath)).toHaveLength(2)
  expect(mixedConnections.filter((connection) => !connection.electricalBranch!.nativeLogicalPath).length).toBeGreaterThan(0)
  expect(mixed.portPointPathingSolver!.stats.electricalTreePhysicalEdgeCount).toBeGreaterThan(0)
  expect(evaluateRelaxedDrc({ inputSrj: mixedInput, srjWithPointPairs: mixed.srjWithPointPairs!, routedTraces: mixed.getOutputSimplifiedPcbTraces() }).errors).toEqual([])
})
