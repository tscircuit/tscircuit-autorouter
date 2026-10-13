import { expect, test } from "bun:test"
import { checkEachPcbPortConnectedToPcbTraces, checkSourceTracesHavePcbTraces, checkViaPadClearance } from "@tscircuit/checks"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import capturedInput from "./fixtures/gameboy-preserved-pico.srj.json"

test("Game Boy routes VBUS around the preserved Pico copper", (): void => {
  // abse/gameboy 1.0.16, captured from tscircuit 0.0.2837. Placement checks and
  // impossible component length limits were relaxed before capturing routing.
  const input = structuredClone(capturedInput) as SimpleRouteJson
  const original = structuredClone(input)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, { effort: 1 })
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBeTrue()
  expect(input).toEqual(original)
  const output = solver.getOutputSimpleRouteJson()
  const drc = evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: output.traces!,
    includeBoardClearance: true,
    drcOptions: { traceClearance: input.minTraceToPadEdgeClearance },
  })
  expect(drc.errors).toEqual([])
  expect(checkSourceTracesHavePcbTraces(drc.circuitJson)).toEqual([])
  expect(checkEachPcbPortConnectedToPcbTraces(drc.circuitJson)).toEqual([])
  // The captured Pico already has one foreign-net via too close to R_LED.
  // Include that rule explicitly: the generic routing DRC omits via-pad gaps.
  const baseline = evaluateRelaxedDrc({
    inputSrj: input, srjWithPointPairs: solver.srjWithPointPairs!, routedTraces: [],
  })
  const viaPadGaps = [baseline, drc].map(({ circuitJson }) => {
    const connMap = getFullConnectivityMapFromCircuitJson(circuitJson)
    connMap.addConnections(circuitJson.flatMap((element) =>
      element.type === "pcb_via" && element.pcb_trace_id
        ? [[element.pcb_via_id, element.pcb_trace_id]] : [],
    ))
    return checkViaPadClearance(circuitJson, { connMap }).map((error) => ({
      center: error.center, actual_clearance: error.actual_clearance,
    }))
  })
  expect(viaPadGaps[0]).toHaveLength(1)
  expect(viaPadGaps[1]).toEqual(viaPadGaps[0])
})
