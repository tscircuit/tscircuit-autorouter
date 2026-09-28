import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { createPipeline9LengthMatchingPreloadedInput } from "../fixtures/createPipeline9LengthMatchingPreloadedInput"

test("Pipeline9 routes a crossing connection around immutable length-matched copper", (): void => {
  const input = createPipeline9LengthMatchingPreloadedInput(1)
  input.connections.push({
    name: "crossing",
    pointsToConnect: [
      { x: 5, y: -3, layer: "top", pcb_port_id: "crossing_start" },
      { x: 5, y: 4, layer: "top", pcb_port_id: "crossing_end" },
    ],
  })
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solveUntilPhase("componentDetectionSolver")
  const matchedTraces = structuredClone(
    solver.srj.traces!.filter((trace) => trace.pcb_trace_id !== "fixed"),
  )
  expect(matchedTraces).toHaveLength(2)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  expect(routedTraces.some((trace) => trace.connection_name === "crossing")).toBe(true)
  for (const matchedTrace of matchedTraces) {
    expect(routedTraces.find((trace) => trace.pcb_trace_id === matchedTrace.pcb_trace_id)).toEqual(matchedTrace)
  }
  expect(evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  }).errors).toHaveLength(0)
})
