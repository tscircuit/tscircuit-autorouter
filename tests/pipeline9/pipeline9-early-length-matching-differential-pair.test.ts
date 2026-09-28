import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import fixture from "../fixtures/core-differential-pair-pad-clearance.json"

test("Pipeline9 preserves matched differential pairs while routing another net", (): void => {
  const input = structuredClone(fixture) as SimpleRouteJson
  input.connections.push({
    name: "ordinary",
    pointsToConnect: [
      { x: -8, y: -8, layer: "top", pcb_port_id: "ordinary_start" },
      { x: 8, y: -8, layer: "top", pcb_port_id: "ordinary_end" },
    ],
  })
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const earlyTraces = solver.earlyLengthMatchingSolver!.getOutputSimplifiedPcbTraces()
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(earlyTraces).toHaveLength(2)
  expect(traces).toHaveLength(3)
  for (const trace of earlyTraces) {
    expect(traces.find((candidate) => candidate.pcb_trace_id === trace.pcb_trace_id)).toEqual(trace)
  }
  expect(evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: traces,
  }).errors).toHaveLength(0)
})
