import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { assertBusAllowedLayers } from "../fixtures/assertBusAllowedLayers"
import { createBusLayerInput } from "../fixtures/bus-layer-input"

test("Pipeline9 reroutes a blocked bus on legal layers and completes normally", (): void => {
  const srj = createBusLayerInput()
  for (const point of srj.connections[0]!.pointsToConnect) point.pcb_port_id = point.pointId
  srj.buses![0]!.allowedLayers = ["top", "inner2"]
  // A wall taller than the routing bounds prevents a top-layer detour.
  srj.obstacles = [{ type: "rect", center: { x: 0, y: 0 }, width: 0.4, height: 40, layers: ["top"], connectedTo: [] },
    ...srj.connections[0]!.pointsToConnect.map((point) => ({
      type: "rect" as const, center: { x: point.x, y: point.y },
      width: 0.3, height: 0.3, layers: ["top"], connectedTo: [point.pointId!, "DDR_D0"],
    })),
  ]
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, { cacheProvider: null })
  solver.solveUntilPhase("busLayerRoutingSolver")
  const initial = solver.getNewTracesBeforePowerExpansion()
  expect(() => assertBusAllowedLayers(srj, initial)).toThrow()
  solver.solve()
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.busLayerRoutingSolver?.stats.accepted).toBe(true)
  expect(() => assertBusAllowedLayers(srj, traces)).not.toThrow()
  expect(evaluateRelaxedDrc({ inputSrj: srj, srjWithPointPairs: solver.srjWithPointPairs!, routedTraces: traces }).errors).toHaveLength(0)
})
