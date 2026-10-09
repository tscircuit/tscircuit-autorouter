import { expect, test } from "bun:test"
import { addAutoroutingViaTraceIds } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimplifiedPcbTrace } from "lib/types"
import { copperPourReservationInput } from "./fixtures/copper-pour-reservations"

test("native through vias obey the declared circular pad clearance without consuming ground planes", (): void => {
  const input = copperPourReservationInput()
  input.minViaEdgeToPadEdgeClearance = 0.1
  const pad = input.obstacles[2]!
  pad.shape = "circle"
  pad.width = 0.4
  pad.height = 0.4
  pad.circuitJsonMetadata = { pcb_smtpad_id: "pcb_smtpad_ground", pcb_port_id: "pcb_port_ground" }
  const original = JSON.stringify(input)
  const traceAt = (y: number): SimplifiedPcbTrace => ({
    type: "pcb_trace", pcb_trace_id: "DATA_route", connection_name: "DATA",
    connectsTo: ["pcb_port_signal_0", "pcb_port_signal_1"],
    route: [
      { route_type: "wire", x: -3, y: 0, width: 0.1, layer: "top", start_pcb_port_id: "pcb_port_signal_0" },
      { route_type: "wire", x: -2, y: 0, width: 0.1, layer: "top" },
      { route_type: "via", x: -2, y: 0, from_layer: "top", to_layer: "bottom", via_diameter: 0.3, via_hole_diameter: 0.15, layers: ["top", "inner1", "inner2", "bottom"] },
      { route_type: "wire", x: -2, y: 0, width: 0.1, layer: "bottom" },
      { route_type: "wire", x: 0, y, width: 0.1, layer: "bottom" },
      { route_type: "via", x: 0, y, from_layer: "bottom", to_layer: "top", via_diameter: 0.3, via_hole_diameter: 0.15, layers: ["top", "inner1", "inner2", "bottom"] },
      { route_type: "wire", x: 0, y, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0.7, width: 0.1, layer: "top" },
      { route_type: "wire", x: 3, y: 0, width: 0.1, layer: "top", end_pcb_port_id: "pcb_port_signal_1" },
    ],
  })
  const bad = evaluateRelaxedDrc({ inputSrj: input, srjWithPointPairs: input, routedTraces: [traceAt(0.4030649)] })
  const violation = bad.errors.find(error => error.type === "pcb_pad_pad_clearance_error")
  expect(violation).toBeDefined()
  expect(violation?.actual_clearance).toBeCloseTo(0.0530649, 6)
  expect(violation?.minimum_clearance).toBe(0.1)
  expect(bad.locationAwareErrors.some(error => error.type === "pcb_pad_pad_clearance_error")).toBe(true)
  const ownedErrors = addAutoroutingViaTraceIds({
    errors: bad.errors as unknown as Array<Record<string, unknown>>,
    circuitJson: bad.circuitJson,
    evaluatedTraceIds: new Set(["DATA_route"]),
  })
  expect(ownedErrors.find(error => error.type === "pcb_pad_pad_clearance_error"))
    .toMatchObject({ pcb_via_ids: ["via_1"], pcb_trace_ids: ["DATA_route"] })
  expect(bad.circuitJson.find(element => element.type === "pcb_smtpad" && element.pcb_smtpad_id === "pcb_smtpad_ground"))
    .toMatchObject({ shape: "circle", radius: 0.2 })
  expect(bad.circuitJson.filter(element => element.type === "pcb_smtpad")).toHaveLength(3)
  const signal = bad.circuitJson.find(element => element.type === "source_trace" && element.source_trace_id === "DATA")
  expect(signal?.type === "source_trace" && signal.connected_source_net_ids?.includes("GROUND")).toBe(false)
  const safe = evaluateRelaxedDrc({ inputSrj: input, srjWithPointPairs: input, routedTraces: [traceAt(0.46)] })
  expect(safe.errors).toEqual([])
  expect(safe.circuitJson.filter(element => element.type === "pcb_via").every(via => via.layers.length === 4)).toBe(true)
  expect(input.obstacles.filter(obstacle => obstacle.isCopperPour)).toHaveLength(2)
  expect(JSON.stringify(input)).toBe(original)
  const stricter = { ...input, minViaEdgeToPadEdgeClearance: 0.15 }
  const strict = evaluateRelaxedDrc({ inputSrj: stricter, srjWithPointPairs: stricter, routedTraces: [traceAt(0.46)], drcOptions: { traceClearance: 0.05 } })
  expect(strict.errors.some(error => error.type === "pcb_pad_pad_clearance_error" && error.minimum_clearance === 0.15)).toBe(true)
})
