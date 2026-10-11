import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { getViaInPadDrcErrors } from "lib/testing/getViaInPadDrcErrors"
import capturedCircuit from "./fixtures/hmc6343ViaInPad.circuit.json"

test("connected via copper can touch JP1 when its drill clears the pad", () => {
  const circuit = structuredClone(capturedCircuit) as AnyCircuitElement[]
  const via = circuit.find((element) => element.type === "pcb_via" && element.pcb_via_id === "pcb_via_2")
  const pad = circuit.find((element) => element.type === "pcb_smtpad" && element.pcb_smtpad_id === "pcb_smtpad_41")
  if (!via || via.type !== "pcb_via" || !pad || pad.type !== "pcb_smtpad" || pad.shape !== "rect") {
    throw new Error("Missing captured HMC6343 via or jumper pad")
  }
  via.x = pad.x + pad.width / 2 + 0.125
  via.y = pad.y
  expect(via.hole_diameter / 2).toBeLessThan(0.125)
  expect(via.outer_diameter / 2).toBeGreaterThan(0.125)
  expect(getViaInPadDrcErrors(circuit)).toEqual([])
})
