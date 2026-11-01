import { expect, test } from "bun:test"
import { normalizePipeline9DrcErrorsForRepair } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/normalizePipeline9DrcErrorsForRepair"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getDrcErrorTraceIds } from "lib/utils/getDrcErrorTraceIds"
import {
  issue3130Input,
  issue3130Traces,
} from "./fixtures/issue3130-via-pad-clearance"

test("via-pad DRC respects connectivity and layers and retains preloaded route ownership", (): void => {
  for (const scenario of ["same-net", "disjoint-layers", "at-clearance"]) {
    const input = structuredClone(issue3130Input)
    input.connections = input.connections.slice(0, 1)
    input.obstacles = input.obstacles.slice(0, 1)
    const traces = structuredClone(issue3130Traces.slice(0, 1))
    if (scenario === "same-net") {
      input.obstacles[0]!.connectedTo = ["escape_0", "start_0"]
      input.obstacles[0]!.circuitJsonMetadata = {
        pcb_smtpad_id: "neighbor_pad_0",
        pcb_port_id: "start_0",
      }
      input.connections[0]!.pointsToConnect[0]!.x = 0
      const start = traces[0]!.route[0]!
      if (start.route_type !== "wire") {
        throw new Error("The escape must start with a wire")
      }
      start.x = 0
    } else if (scenario === "disjoint-layers") {
      input.layerCount = 4
      input.allowBlindAndBuriedVias = true
      input.obstacles[0]!.layers = ["bottom"]
      input.connections[0]!.pointsToConnect[1]!.layer = "inner1"
      for (const point of traces[0]!.route) {
        if (point.route_type === "via") point.to_layer = "inner1"
        else if (point.route_type === "wire" && point.layer === "bottom") {
          point.layer = "inner1"
        }
      }
    } else {
      for (const point of traces[0]!.route) {
        if (
          (point.route_type === "wire" || point.route_type === "via") &&
          point.x === 0.95
        ) {
          point.x = 1
        }
      }
    }
    const drc = evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs: input,
      routedTraces: traces,
    })
    expect(drc.errors, scenario).toHaveLength(0)
  }

  const input = structuredClone(issue3130Input)
  input.traces = structuredClone(issue3130Traces.slice(0, 1))
  const routedTraces = structuredClone(issue3130Traces.slice(1))
  const before = structuredClone({ input, routedTraces })
  const drc = evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: input,
    routedTraces,
  })
  expect(drc.errors).toHaveLength(2)
  const mapped = normalizePipeline9DrcErrorsForRepair({
    errors: drc.errors as unknown as Record<string, unknown>[],
    circuitJson: drc.circuitJson,
    newTraceIds: new Set(routedTraces.map((trace) => trace.pcb_trace_id)),
  })
  expect(mapped.map(getDrcErrorTraceIds)).toEqual([
    ["trace_escape_0"],
    ["trace_escape_1"],
  ])
  expect(mapped[1]!.pcb_trace_id).toBe("trace_escape_1")
  expect({ input, routedTraces }).toEqual(before)
})
