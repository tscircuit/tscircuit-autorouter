import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"

test("physical forest cooperates with future foreign routing while preserving preloaded output ownership", () => {
  const input: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.15,
    bounds: { minX: -6, maxX: 6, minY: -6, maxY: 6 }, obstacles: [],
    connections: [
      { name: "tree", pointsToConnect: [
        { x: -3, y: 0, layer: "top", pointId: "a" },
        { x: 3, y: 0, layer: "top", pointId: "b" },
        { x: 0, y: 4, layer: "top", pointId: "c" },
      ] },
      { name: "crossing", pointsToConnect: [
        { x: 0, y: -3, layer: "top", pointId: "d" },
        { x: 1, y: 3, layer: "top", pointId: "e" },
      ] },
      { name: "fixed", pointsToConnect: [
        { x: -4, y: -4, layer: "bottom", pointId: "f0" },
        { x: 4, y: -4, layer: "bottom", pointId: "f1" },
      ] },
    ],
    traces: [{ type: "pcb_trace", pcb_trace_id: "original_fixed", connection_name: "fixed", connectsTo: ["f0", "f1"], route: [
      { route_type: "wire", x: -4, y: -4, width: 0.15, layer: "bottom" },
      { route_type: "wire", x: 4, y: -4, width: 0.15, layer: "bottom" },
    ] }],
  }
  for (const connection of input.connections) {
    for (const point of connection.pointsToConnect) {
      const terminalId = `pcb_port_${point.pointId}`
      point.pcb_port_id = terminalId
      input.obstacles.push({ type: "rect", center: { x: point.x, y: point.y }, width: 0.5, height: 0.5,
        layers: [point.layer!], connectedTo: [connection.name, terminalId],
        circuitJsonMetadata: { pcb_port_id: terminalId, pcb_smtpad_id: `pad_${point.pointId}` } })
    }
  }
  const original = structuredClone(input)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, { cacheProvider: null })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.physicalNetForestSolver!.diagnostics.committedNets).toBe(1)
  expect(solver.physicalNetForestSolver!.diagnostics.physicallyValidatedNets).toBe(1)
  expect(solver.getUpdatedPreloadedTraces().map((trace) => trace.pcb_trace_id)).toEqual(["original_fixed"])
  const output = solver.getOutputSimplifiedPcbTraces()
  expect(output.some((trace) => trace.pcb_trace_id === "original_fixed")).toBe(false)
  expect(evaluateRelaxedDrc({ inputSrj: original, srjWithPointPairs: solver.srjWithPointPairs!, routedTraces: output, includeBoardClearance: true }).errors).toEqual([])
  expect(input).toEqual(original)
})
