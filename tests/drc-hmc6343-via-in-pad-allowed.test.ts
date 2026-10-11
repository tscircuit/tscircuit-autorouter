import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import capturedCircuit from "./fixtures/hmc6343ViaInPad.circuit.json"

test("explicit via-in-pad permission permits the connected JP1 drill", () => {
  expect(
    getDrcErrors(capturedCircuit as AnyCircuitElement[], {
      allowViaInPad: true,
    }).errors,
  ).toEqual([])
})
