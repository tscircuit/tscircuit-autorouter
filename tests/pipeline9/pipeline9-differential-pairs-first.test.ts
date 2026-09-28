import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "../../lib/types"
import fixture from "../fixtures/core-differential-pair-pad-clearance.json"

test("Pipeline9 preloads matched pairs before routing crossing ordinary nets", (): void => {
  const input: SimpleRouteJson = structuredClone(fixture) as SimpleRouteJson
  input.connections.push({
    name: "ordinary",
    pointsToConnect: [
      { x: 0, y: -4, layer: "top", pcb_port_id: "ordinary_start" },
      { x: 0, y: 4, layer: "top", pcb_port_id: "ordinary_end" },
    ],
  })
  for (const point of input.connections.at(-1)!.pointsToConnect) {
    input.obstacles.push({
      type: "rect",
      center: { x: point.x, y: point.y },
      width: 0.2,
      height: 0.2,
      layers: ["top"],
      connectedTo: [point.pcb_port_id!],
      circuitJsonMetadata: { pcb_port_id: point.pcb_port_id },
    })
  }
  const originalInput = structuredClone(input)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solveUntilPhase("componentDetectionSolver")
  const early = solver.differentialPairRoutingSolver!.getOutput()
  expect(early.routedTraces).toHaveLength(2)
  expect(early.srj.connections.map((connection) => connection.name)).toEqual([
    "ordinary",
  ])
  expect(solver.srj.traces).toEqual(early.routedTraces)
  expect(solver.highDensityRouteSolver).toBeUndefined()

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces.map((trace) => trace.connection_name).sort()).toEqual([
    "ordinary",
    "source_trace_0",
    "source_trace_1",
  ])
  for (const trace of early.routedTraces) {
    expect(
      traces.find((candidate) => candidate.pcb_trace_id === trace.pcb_trace_id),
    ).toEqual(trace)
  }
  expect(new Set(traces.map((trace) => trace.pcb_trace_id)).size).toBe(
    traces.length,
  )
  expect(solver.getOutputSimpleRouteJson().connections).toEqual(
    input.connections,
  )
  expect(
    evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: traces,
    }).errors,
  ).toEqual([])
  expect(input).toEqual(originalInput)
})
