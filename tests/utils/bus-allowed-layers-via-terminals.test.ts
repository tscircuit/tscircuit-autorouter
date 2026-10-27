import { expect, test } from "bun:test"
import { assertBusAllowedLayers } from "../fixtures/assertBusAllowedLayers"
import {
  createBusLayerInput,
  createBusLayerTrace,
} from "../fixtures/bus-layer-input"

test("bus layer checks constrain via and plated-hole routing endpoints", (): void => {
  const srj = createBusLayerInput()
  const trace = createBusLayerTrace("inner1")
  trace.route = trace.route.filter((point) => point.route_type === "via")
  expect(() => assertBusAllowedLayers(srj, [trace])).toThrow(
    'uses prohibited routing layer "inner1"',
  )
  trace.route = [
    {
      route_type: "through_obstacle",
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0 },
      from_layer: "top",
      to_layer: "inner1",
      width: 0.1,
    },
  ]
  expect(() => assertBusAllowedLayers(srj, [trace])).toThrow(
    'uses prohibited routing layer "inner1"',
  )
})
