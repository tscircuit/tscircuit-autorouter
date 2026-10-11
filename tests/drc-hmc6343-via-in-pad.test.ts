import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import capturedCircuit from "./fixtures/hmc6343ViaInPad.circuit.json"

test("HMC6343 repair DRC detects the drill inside its connected JP1 pad", () => {
  const circuit = capturedCircuit as AnyCircuitElement[]
  const connMap = getFullConnectivityMapFromCircuitJson(circuit)
  connMap.addConnections([["pcb_via_2", "source_net_2_mst0_0"]])
  expect(connMap.areIdsConnected("pcb_via_2", "pcb_smtpad_41")).toBe(true)

  const result = getDrcErrors(circuit)
  expect(result.errors).toHaveLength(1)
  expect(result.errorsWithCenters[0]).toMatchObject({
    type: "pcb_pad_pad_clearance_error",
    pcb_trace_id: "source_net_2_mst0_0",
    pcb_pad_ids: ["pcb_via_2", "pcb_smtpad_41"],
    pcb_via_ids: ["pcb_via_2"],
    minimum_clearance: 0,
  })
  expect(result.errors[0]?.message).toContain("JP1.pin2")
  expect(result.locationAwareErrors).toHaveLength(1)
})
