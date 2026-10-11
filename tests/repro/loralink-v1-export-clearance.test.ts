import { expect, test } from "bun:test"
import {
  checkEachPcbTraceNonOverlapping,
  checkHoleTraceClearance,
  checkViaPadClearance,
  checkViaTraceClearance,
} from "@tscircuit/checks"
import type { AnyCircuitElement } from "circuit-json"
import capturedBoard from "../../fixtures/bug-reports/loralink-v1-export-clearance/loralink-v1.circuit.json" with { type: "json" }

// Characterize the frozen export, not the output of the current routing pipeline.
test("LoRaLink V1 exported geometry reproduces its eight recorded clearance errors", (): void => {
  const circuitJson = structuredClone(capturedBoard).filter(
    (element) =>
      !element.type.endsWith("_error") && !element.type.endsWith("_warning"),
  ) as AnyCircuitElement[]

  const overlaps = checkEachPcbTraceNonOverlapping(circuitJson)
  for (const id of [
    "overlap_source_net_20_mst1_0_pcb_via_87",
    "overlap_source_net_20_mst1_0_pcb_via_84",
    "overlap_source_net_1_mst2_0_pcb_via_82",
  ]) {
    expect(overlaps).toContainEqual(
      expect.objectContaining({ pcb_trace_error_id: id }),
    )
  }

  const viaTraceErrors = checkViaTraceClearance(circuitJson)
  for (const [viaId, traceId, clearance] of [
    ["pcb_via_17", "source_net_0_mst42_0", 0.02797816842550896],
    ["pcb_via_95", "source_net_8_mst3_0", 0.12999247005712347],
    ["pcb_via_98", "source_net_25_0", 0.09332983635639311],
  ] as const) {
    const error = viaTraceErrors.find(
      (error) => error.pcb_via_id === viaId && error.pcb_trace_id === traceId,
    )
    expect(error).toBeDefined()
    expect(error!.minimum_clearance).toBe(0.15)
    expect(error!.actual_clearance).toBeCloseTo(clearance, 10)
  }

  expect(checkViaPadClearance(circuitJson)).toContainEqual(
    expect.objectContaining({
      pcb_pad_ids: ["pcb_via_7", "pcb_smtpad_141"],
      minimum_clearance: 0.1,
      actual_clearance: 0,
    }),
  )
  expect(checkHoleTraceClearance(circuitJson)).toContainEqual(
    expect.objectContaining({
      pcb_trace_id: "source_net_1_mst1_0",
      pcb_trace_error_id: "overlap_source_net_1_mst1_0_pcb_hole_0",
      message: expect.stringContaining("gap: 0.117721mm, required: 0.2mm"),
    }),
  )
})
