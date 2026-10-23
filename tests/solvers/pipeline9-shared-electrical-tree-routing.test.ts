import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"

test("default Pipeline9 routes physical shared edges once and preserves the original electrical demands through export", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.1,
    bounds: { minX: -4, maxX: 34, minY: -4, maxY: 30 },
    obstacles: [{ type: "rect", center: { x: 10, y: 10 }, width: 2, height: 2,
      layers: ["top", "bottom"], connectedTo: [] }],
    connections: [{ name: "bus", pointsToConnect: [
      { x: 0, y: 0, layer: "top", pcb_port_id: "A" },
      { x: 30, y: 0, layer: "top", pcb_port_id: "B" },
      { x: 19, y: 25, layer: "top", pcb_port_id: "C" },
    ] }],
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(input), { cacheProvider: null })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const pathing = solver.portPointPathingSolver!
  const logical = pathing.getOutput().nodesWithPortPoints.flatMap((node) => node.portPointsInPairs ?? [])
  const physical = pathing.getRoutingOutput()
  const routed = solver.highDensityNodePortPoints!.flatMap((node) => node.portPointsInPairs ?? [])
  expect(routed.length).toBe(physical.sharedEdges.length)
  expect(routed.length).toBeLessThan(logical.length)
  expect(physical.sharedEdges.some((edge) => edge.owners.length > 1)).toBe(true)
  expect(pathing.stats.electricalTreeVerifiedDemandCount).toBe(solver.srjWithPointPairs!.connections.length)
  expect(pathing.stats.electricalTreeSharedCacheReferenceCount).toBeGreaterThan(0)
  for (const connection of solver.getRoutingConnections()) {
    const owners = connection.electricalBranch!.logicalConnectionNames
    expect(owners.every((owner) => solver.connMap.areIdsConnected(owner, connection.name))).toBe(true)
  }
  const output = solver.getOutputSimplifiedPcbTraces()
  expect(evaluateRelaxedDrc({ inputSrj: input, srjWithPointPairs: solver.srjWithPointPairs!, routedTraces: output }).errors).toHaveLength(0)
})
