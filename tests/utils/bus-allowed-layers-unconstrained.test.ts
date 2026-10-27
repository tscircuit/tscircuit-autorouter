import { expect, test } from "bun:test"
import { assertBusAllowedLayers } from "../fixtures/assertBusAllowedLayers"
import {
  createBusLayerInput,
  createBusLayerTrace,
} from "../fixtures/bus-layer-input"

test("bus layer checks leave unconstrained buses and unrelated nets unchanged", (): void => {
  const srj = createBusLayerInput()
  const trace = createBusLayerTrace("inner1")
  trace.connection_name = "UART_TX"
  trace.connectsTo = []
  expect(() => assertBusAllowedLayers(srj, [trace])).not.toThrow()
  delete srj.buses![0]!.allowedLayers
  expect(() =>
    assertBusAllowedLayers(srj, [createBusLayerTrace("inner1")]),
  ).not.toThrow()
  delete srj.buses
  expect(() =>
    assertBusAllowedLayers(srj, [createBusLayerTrace("inner1")]),
  ).not.toThrow()
})
