import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { copperPourDrcInput, copperPourDrcTraces } from "./fixtures/copper-pour-drc-input"

test("relaxed DRC reports an escape trace that does not reach the pour layer", () => {
  const traces = structuredClone(copperPourDrcTraces)
  traces[1].route = traces[1].route.slice(0, 2)
  const { errors } = evaluateRelaxedDrc({
    inputSrj: copperPourDrcInput,
    srjWithPointPairs: copperPourDrcInput,
    routedTraces: traces,
  })

  expect(errors).toHaveLength(1)
  expect(errors[0]).toMatchObject({ type: "pcb_trace_error" })
})
