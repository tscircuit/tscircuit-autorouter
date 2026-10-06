import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { copperPourReservationInput, copperPourSignalTrace } from "./fixtures/copper-pour-reservations"

test("native four-layer through vias keep both ground reservations and antipads", (): void => {
  const input = copperPourReservationInput()
  const trace = copperPourSignalTrace("bottom")
  input.traces = [trace]
  const original = JSON.stringify(input)
  const reference = evaluateRelaxedDrc({ inputSrj: input, srjWithPointPairs: input, routedTraces: [] })
  expect(reference.errors).toEqual([])
  expect(reference.errorsWithCenters).toEqual([])
  expect(input.obstacles.filter(obstacle => obstacle.isCopperPour)).toHaveLength(2)
  expect(trace.route.filter(point => point.route_type === "via")).toHaveLength(2)
  expect(JSON.stringify(input)).toBe(original)
})
