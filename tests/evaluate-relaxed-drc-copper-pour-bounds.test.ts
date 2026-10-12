import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { copperPourDrcInput, copperPourDrcTraces } from "./fixtures/copper-pour-drc-input"

test("relaxed DRC reports a via outside its net's copper pour", () => {
  const inputSrj = structuredClone(copperPourDrcInput)
  inputSrj.obstacles[2].center.x = -2
  inputSrj.obstacles[2].width = 3
  const { errors } = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs: inputSrj,
    routedTraces: copperPourDrcTraces,
  })

  expect(errors).toHaveLength(1)
  expect(errors[0]).toMatchObject({ type: "pcb_trace_error" })
})
