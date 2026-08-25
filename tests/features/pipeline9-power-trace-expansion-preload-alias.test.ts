import { expect, test } from "bun:test"
import type { PowerTraceExpanderOptions } from "@tscircuit/power-trace-expander"
import type { Pipeline7PowerTraceExpansionInput } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/prepare-pipeline7-power-trace-expansion-input"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import type { SimpleRouteJson } from "lib/types"
import scenario from "./preexisting-connected-traces/srj/preexisting-connected-traces06.srj.json" with {
  type: "json",
}

test("Pipeline9 expands a preloaded power trace named by a connected alias", () => {
  const srj = structuredClone(scenario) as SimpleRouteJson
  const powerConnection = srj.connections[0]!
  powerConnection.nominalTraceWidth = 0.6
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj)
  const powerStep = solver.pipelineDef.find(
    (step) => step.solverName === "powerTraceExpansionSolver",
  )!

  expect(powerStep.solverName).toBe("powerTraceExpansionSolver")
  const originalGetNewTracesBeforePowerExpansion =
    solver.getNewTracesBeforePowerExpansion.bind(solver)
  const originalGetUpdatedPreloadedTraces =
    solver.getUpdatedPreloadedTraces.bind(solver)
  solver.getNewTracesBeforePowerExpansion = () => []
  solver.getUpdatedPreloadedTraces = () => structuredClone(srj.traces ?? [])
  const [rawInput, rawOptions] = powerStep.getConstructorParams(solver)
  solver.getNewTracesBeforePowerExpansion =
    originalGetNewTracesBeforePowerExpansion
  solver.getUpdatedPreloadedTraces = originalGetUpdatedPreloadedTraces
  const input = rawInput as Pipeline7PowerTraceExpansionInput
  const options = rawOptions as PowerTraceExpanderOptions

  expect(options.onlyConnectionNames).toEqual([powerConnection.name])
  expect(input.fixedTraces).toEqual([])
  expect(input.traces).toHaveLength(1)
  expect(input.traces?.[0]).toMatchObject({
    pcb_trace_id: "preexisting_escape_through_u1_pin1",
    connection_name: "preexisting_escape_through_u1_pin1",
    __replaces_pcb_trace_id: "preexisting_escape_through_u1_pin1",
  })

  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const completeOutput = solver.getOutputSimpleRouteJson().traces ?? []
  expect(
    completeOutput.filter(
      (trace) =>
        trace.__replaces_pcb_trace_id === "preexisting_escape_through_u1_pin1",
    ),
  ).toHaveLength(1)
  expect(new Set(completeOutput.map((trace) => trace.pcb_trace_id)).size).toBe(
    completeOutput.length,
  )
})
