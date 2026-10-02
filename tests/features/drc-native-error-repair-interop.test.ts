import { expect, test } from "bun:test"
import type {
  PcbPadTraceClearanceError,
  PcbTraceError,
  PcbViaClearanceError,
  PcbViaTraceClearanceError,
} from "circuit-json"
import type { DrcEvaluator } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/types"
import { normalizePipeline9DrcErrorsForRepair } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/normalizePipeline9DrcErrorsForRepair"
import type { GetDrcErrorsResult } from "lib/testing/getDrcErrors"

test("native DRC errors retain typed fields and geometry through repair adapters", () => {
  const center = { x: 1, y: 2 }
  const traceError: PcbTraceError = {
    type: "pcb_trace_error",
    error_type: "pcb_trace_error",
    message: "fixed and movable traces overlap",
    pcb_trace_error_id: "overlap_fixed_movable",
    pcb_trace_id: "fixed",
    source_trace_id: "source_trace_1",
    pcb_component_ids: ["pcb_component_1"],
    pcb_port_ids: ["pcb_port_1"],
    center,
  }
  const viaTraceError: PcbViaTraceClearanceError = {
    type: "pcb_via_trace_clearance_error",
    error_type: "pcb_via_trace_clearance_error",
    message: "movable via too close to fixed trace",
    pcb_via_trace_clearance_error_id: "via_trace_clearance_via_1_fixed",
    pcb_via_id: "via_1",
    pcb_trace_id: "fixed",
    minimum_clearance: 0.2,
    actual_clearance: 0.1,
    center,
  }
  const padTraceError: PcbPadTraceClearanceError = {
    type: "pcb_pad_trace_clearance_error",
    error_type: "pcb_pad_trace_clearance_error",
    message: "trace too close to pad",
    pcb_pad_trace_clearance_error_id: "pad_trace_clearance_pad_1_fixed",
    pcb_pad_id: "pad_1",
    pcb_trace_id: "fixed",
    center,
  }
  const viaError: PcbViaClearanceError = {
    type: "pcb_via_clearance_error",
    error_type: "pcb_via_clearance_error",
    message: "vias too close",
    pcb_error_id: "via_clearance_via_1_via_2",
    pcb_via_ids: ["via_1", "via_2"],
    pcb_center: center,
  }
  const errors: GetDrcErrorsResult["errors"] = [
    traceError,
    viaTraceError,
    padTraceError,
    viaError,
  ]
  const errorsWithCenters: GetDrcErrorsResult["errorsWithCenters"] = errors.map(
    (error) => ({ ...error, center }),
  )
  const repairInput: ReturnType<DrcEvaluator> = {
    errors,
    errorsWithCenters,
  }
  expect(repairInput.errors).toBe(errors)
  expect(repairInput.errorsWithCenters).toBe(errorsWithCenters)
  // The record-based API does not erase discrimination at the native boundary.
  const nativeTrace = errors.find((error) => error.type === "pcb_trace_error")
  const sourceTraceId: string | undefined = nativeTrace?.source_trace_id
  expect(sourceTraceId).toBe("source_trace_1")

  const normalized = normalizePipeline9DrcErrorsForRepair({
    errors: repairInput.errors,
    circuitJson: [
      {
        type: "pcb_via",
        pcb_via_id: "via_1",
        pcb_trace_id: "movable",
        x: 1,
        y: 2,
        hole_diameter: 0.2,
        outer_diameter: 0.3,
        layers: ["top", "bottom"],
      },
    ],
    newTraceIds: new Set(["movable"]),
  })
  expect(normalized[0]).toMatchObject({
    pcb_trace_id: "movable",
    pcb_trace_ids: ["movable", "fixed"],
    pcb_trace_error_id: "overlap_movable_fixed",
    source_trace_id: "source_trace_1",
    pcb_component_ids: ["pcb_component_1"],
    pcb_port_ids: ["pcb_port_1"],
  })
  expect(normalized[1]).toMatchObject({
    pcb_trace_id: "movable",
    pcb_via_id: "via_1",
    pcb_trace_ids: ["movable", "fixed"],
    minimum_clearance: 0.2,
    actual_clearance: 0.1,
    pcb_via_trace_clearance_error_id: "via_trace_clearance_via_1_fixed",
  })
  expect(normalized[2]).toBe(errors[2])
  expect(normalized[3]?.pcb_error_id).toBe(viaError.pcb_error_id)
  expect(normalized[3]?.pcb_center).toBe(center)
  for (const error of normalized.slice(0, 3)) {
    expect(error.center).toBe(center)
  }
  expect(traceError.pcb_trace_id).toBe("fixed")
  expect(viaTraceError.pcb_trace_id).toBe("fixed")
})
