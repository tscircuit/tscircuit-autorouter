import { expect, test } from "bun:test"
import { PrepareTraceSimplificationSolver } from "lib/autorouter-pipelines/AutoroutingPipeline11_Simplification/PrepareTraceSimplificationSolver"
import { ValidateTraceSimplificationSolver } from "lib/autorouter-pipelines/AutoroutingPipeline11_Simplification/ValidateTraceSimplificationSolver"
import {
  issue3130Input,
  issue3130Traces,
} from "./fixtures/issue3130-via-pad-clearance"

test("simplification rejects vias that violate the declared pad-copper rule", (): void => {
  const input = {
    ...structuredClone(issue3130Input),
    traces: structuredClone(issue3130Traces),
  }
  for (const [index, obstacle] of input.obstacles.entries()) {
    const padId = `pcb_smtpad_${index}`
    obstacle.connectedTo.push(padId)
    obstacle.circuitJsonMetadata = { pcb_smtpad_id: padId }
  }
  for (const trace of input.traces) {
    for (const point of trace.route) {
      if (
        (point.route_type === "via" || point.route_type === "wire") &&
        point.x < 2
      ) {
        point.x = 1.1
      }
    }
  }
  const prepare = new PrepareTraceSimplificationSolver({
    inputSrj: input,
    options: {},
  })
  prepare.solve()
  const validation = new ValidateTraceSimplificationSolver({
    preparedInput: prepare.getOutput(),
    outputSrj: { ...input, traces: structuredClone(issue3130Traces) },
  })
  expect(() => validation.solve()).toThrow(
    "Pipeline 11 simplification introduced DRC errors (pcb_pad_pad_clearance_error: 0 -> 2)",
  )
})
