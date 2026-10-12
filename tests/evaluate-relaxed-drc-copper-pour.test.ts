import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { copperPourDrcInput, copperPourDrcTraces } from "./fixtures/copper-pour-drc-input"

test("relaxed DRC connects escape vias through the original inner-layer pour", () => {
  const { errors, circuitJson } = evaluateRelaxedDrc({
    inputSrj: copperPourDrcInput,
    srjWithPointPairs: { ...copperPourDrcInput, obstacles: [] },
    routedTraces: copperPourDrcTraces,
  })

  expect(errors).toHaveLength(0)
  expect(circuitJson.filter((element) => element.type === "pcb_copper_pour")).toMatchObject([
    { shape: "rect", layer: "inner1", center: { x: 0, y: 0 }, width: 8, height: 8 },
  ])
})
