import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { copperPourReservationInput, copperPourSignalTrace } from "./fixtures/copper-pour-reservations"

test("reference endpoint ownership respects native layers and preserves declared through-pad ownership", (): void => {
  const input = copperPourReservationInput()
  input.connections.push({ name: "SUPPLY", pointsToConnect: [{ x: -3, y: 0, layer: "bottom", pcb_port_id: "pcb_port_supply" }] })
  input.obstacles.push({
    type: "rect", center: { x: -3, y: 0 }, width: 0.4, height: 0.4, layers: ["bottom"],
    connectedTo: ["SUPPLY", "pcb_port_supply"],
    circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_supply", pcb_port_id: "pcb_port_supply" },
  }, {
    type: "rect", shape: "circle", center: { x: 3, y: 0 }, width: 0.4, height: 0.4,
    layers: ["top", "inner1", "inner2", "bottom"], connectedTo: ["DATA", "pcb_port_signal_1"],
    circuitJsonMetadata: { pcb_plated_hole_id: "pcb_plated_hole_signal", pcb_port_id: "pcb_port_signal_1" },
  })
  const original = JSON.stringify(input)
  const route = copperPourSignalTrace("bottom")
  const result = evaluateRelaxedDrc({ inputSrj: input, srjWithPointPairs: input, routedTraces: [route] })
  const data = result.circuitJson.find(element => element.type === "source_trace" && element.source_trace_id === "DATA")
  expect(data?.type).toBe("source_trace")
  if (data?.type !== "source_trace") throw new Error("Missing native DATA source ownership")
  expect(data.connected_source_net_ids).not.toContain("SUPPLY")
  expect(data.connected_source_net_ids).not.toContain("pcb_port_supply")
  expect(result.circuitJson.find(element => element.type === "pcb_plated_hole" && element.pcb_plated_hole_id === "pcb_plated_hole_signal"))
    .toMatchObject({ layers: ["top", "inner1", "inner2", "bottom"], pcb_port_id: "pcb_port_signal_1" })
  expect(result.errors).toEqual([])
  const violatesSupply = structuredClone(route)
  violatesSupply.route.splice(4, 0,
    { route_type: "wire", x: -3, y: 0, width: 0.1, layer: "bottom" },
    { route_type: "wire", x: -2, y: 0, width: 0.1, layer: "bottom" },
  )
  const collision = evaluateRelaxedDrc({ inputSrj: input, srjWithPointPairs: input, routedTraces: [violatesSupply] })
  expect(collision.errors.some(error => error.type === "pcb_trace_error" && error.pcb_trace_error_id === "overlap_signal_route_pcb_smtpad_supply")).toBe(true)
  expect(JSON.stringify(input)).toBe(original)
})
