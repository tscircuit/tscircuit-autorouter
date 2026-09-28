import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { createPipeline9LengthMatchingPreloadedInput } from "../fixtures/createPipeline9LengthMatchingPreloadedInput"

test("Pipeline9 preloads every branch of a length-matched multipoint bus", (): void => {
  const input = createPipeline9LengthMatchingPreloadedInput(1)
  input.connections[1]!.pointsToConnect[1]!.x = 8
  input.obstacles.find((obstacle) => obstacle.connectedTo.includes("b_1"))!.center.x = 8
  input.connections[0]!.pointsToConnect.splice(1, 0, {
    x: 5, y: 0, layer: "top", pointId: "a_mid", pcb_port_id: "a_mid",
  })
  input.obstacles.push({
    type: "rect", center: { x: 5, y: 0 }, width: 0.2, height: 0.2,
    layers: ["top"], connectedTo: ["a_mid"],
    circuitJsonMetadata: { pcb_port_id: "a_mid", pcb_smtpad_id: "pad_a_mid" },
  })
  input.connections.push({
    name: "ordinary",
    pointsToConnect: [
      { x: 0, y: -3, layer: "top", pcb_port_id: "ordinary_start" },
      { x: 10, y: -3, layer: "top", pcb_port_id: "ordinary_end" },
    ],
  })
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  const traces = solver.getOutputSimplifiedPcbTraces()
  const earlyTraces = solver.earlyLengthMatchingSolver!.getOutputSimplifiedPcbTraces()
  expect(traces.filter((trace) => trace.connection_name === "a")).toHaveLength(2)
  // The matcher validates the aggregate bus length; preserve every matched branch.
  for (const trace of earlyTraces) {
    expect(traces.find((candidate) => candidate.pcb_trace_id === trace.pcb_trace_id)).toEqual(trace)
  }
  expect(evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: traces,
  }).errors).toEqual([])
})
