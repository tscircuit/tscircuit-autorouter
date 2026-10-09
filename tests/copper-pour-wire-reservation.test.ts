import { expect, test } from "bun:test"
import { createCopperPourTraceEvaluator } from "lib/testing/createCopperPourTraceEvaluator"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimplifiedPcbTrace } from "lib/types"
import { copperPourReservationInput, copperPourSignalTrace } from "./fixtures/copper-pour-reservations"

test("reference DRC preserves actual copper-pour wire reservations without pad identities", (): void => {
  const input = copperPourReservationInput()
  const original = JSON.stringify(input)
  const foreign = copperPourSignalTrace("inner1")
  const reference = evaluateRelaxedDrc({ inputSrj: input, srjWithPointPairs: input, routedTraces: [foreign] })
  const errors = reference.errors.filter(error => "pcb_trace_error_id" in error && error.pcb_trace_error_id.startsWith("copper_pour_overlap_"))
  expect(errors).toHaveLength(1)
  expect(errors[0]).toMatchObject({ pcb_trace_id: foreign.pcb_trace_id, pcb_trace_ids: [foreign.pcb_trace_id] })
  const checker = createCopperPourTraceEvaluator(input, 0.1)
  expect(checker([{ ...foreign, connection_name: "ground_alias", connectsTo: [] }])).toEqual([])
  expect(JSON.stringify(input)).toBe(original)
  const reserved = input.obstacles.find(obstacle => obstacle.isCopperPour)!
  reserved.width = 4
  reserved.height = 0.4
  reserved.ccwRotationDegrees = 45
  const rotatedChecker = createCopperPourTraceEvaluator(input, 0.1)
  const offsetWire = (offset: number): SimplifiedPcbTrace => ({ ...foreign, route: [
    { route_type: "wire" as const, layer: "inner1", width: 0.1, x: -1 - offset / Math.SQRT2, y: -1 + offset / Math.SQRT2 },
    { route_type: "wire" as const, layer: "inner1", width: 0.1, x: 1 - offset / Math.SQRT2, y: 1 + offset / Math.SQRT2 },
  ] })
  expect(rotatedChecker([offsetWire(0.34)])).toHaveLength(1)
  expect(rotatedChecker([offsetWire(0.36)])).toEqual([])
  expect(input.obstacles.filter(obstacle => obstacle.isCopperPour).every(obstacle => obstacle.connectedTo.every(name => !name.startsWith("pcb_port_") && !name.startsWith("pcb_smtpad_")))).toBe(true)
})
