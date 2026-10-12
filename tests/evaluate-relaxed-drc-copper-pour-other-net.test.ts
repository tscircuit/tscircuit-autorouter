import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { copperPourDrcInput, copperPourDrcTraces } from "./fixtures/copper-pour-drc-input"

test("pour bounds do not merge different logical nets during DRC conversion", () => {
  const inputSrj = structuredClone(copperPourDrcInput)
  inputSrj.obstacles[2].connectedTo = ["power"]
  const { circuitJson } = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs: inputSrj,
    routedTraces: copperPourDrcTraces,
  })

  const pour = circuitJson.find((element) => element.type === "pcb_copper_pour")
  expect(pour?.source_net_id).toBeDefined()
  const connectivity = getFullConnectivityMapFromCircuitJson(circuitJson)
  expect(connectivity.areIdsConnected("ground", pour!.source_net_id!)).toBe(false)
})
