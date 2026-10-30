import { expect, test } from "bun:test"
import { assertBusAllowedLayers } from "../fixtures/assertBusAllowedLayers"
import {
  createBusLayerInput,
  createBusLayerTrace,
} from "../fixtures/bus-layer-input"

test("bus layer checks reject unknown layers and explicit empty allowed sets", (): void => {
  const srj = createBusLayerInput()
  srj.buses![0]!.allowedLayers = ["inner3"]
  expect(() =>
    assertBusAllowedLayers(srj, [createBusLayerTrace("inner2")]),
  ).toThrow('Bus "DDR byte 0" allows unknown board layer "inner3"')
  srj.buses![0]!.allowedLayers = []
  expect(() =>
    assertBusAllowedLayers(srj, [createBusLayerTrace("top")]),
  ).toThrow('uses prohibited routing layer "top"')
})
