import * as checks from "@tscircuit/checks"
import { expect, spyOn, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { ownedViaAndPad } from "./fixtures/ownedViaAndPad"

test("clean vias share one placement check while via-pad checks remain opt-in", (): void => {
  const circuitJson = ownedViaAndPad(2)
  const via = circuitJson.find(
    (element): element is Extract<AnyCircuitElement, { type: "pcb_via" }> =>
      element.type === "pcb_via",
  )!
  for (let index = 1; index < 20; index++) {
    circuitJson.push({ ...via, pcb_via_id: `via_${index}`, x: 2 + index * 2 })
  }
  const check = spyOn(checks, "checkViasInPads")
  try {
    expect(
      getDrcErrors(circuitJson, {
        includeViaPadChecks: true,
        includeTraceContinuity: false,
      }).errors,
    ).toEqual([])
    expect(check).toHaveBeenCalledTimes(1)
    expect(
      getDrcErrors(circuitJson, {
        includeViaPadChecks: false,
        includeTraceContinuity: false,
      }).errors,
    ).toEqual([])
    expect(check).toHaveBeenCalledTimes(1)
  } finally {
    check.mockRestore()
  }
})
