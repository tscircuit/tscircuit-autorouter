import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { addPipeline9OriginalViaPlacementMetadata } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9OriginalViaPlacementDrcErrors"
import { makeOriginalViaPlacementMetadataFixture } from "./fixtures/pipeline9OriginalViaPlacementMetadata"

test("unknown, ambiguous, or cross-kind IDs never acquire manufactured via metadata", (): void => {
  const base = makeOriginalViaPlacementMetadataFixture("board")
  const boardError = base.errors[0]!
  const via = base.circuitJson.find((element) => element.type === "pcb_via")!
  const trace = base.circuitJson.find((element) => element.type === "pcb_trace")!
  if (via.type !== "pcb_via" || trace.type !== "pcb_trace") throw new Error("Expected typed fixture elements")
  const cases: Array<{ name: string; error: Record<string, unknown>; circuitJson?: AnyCircuitElement[] }> = [
    { name: "a via-like trace ID", error: { ...boardError, pcb_placement_error_id: `out_of_board_${base.traceId}` } },
    { name: "a nonexistent via", error: { ...boardError, pcb_placement_error_id: "out_of_board_missing_via_123" } },
    { name: "an unknown prefix", error: { ...boardError, pcb_placement_error_id: `unknown_${base.viaId}` } },
    { name: "an embedded trusted prefix", error: { ...boardError, pcb_placement_error_id: `unknown_out_of_board_${base.viaId}` } },
    { name: "a conflicting error type", error: { ...boardError, type: "unknown" } },
    { name: "a conflicting secondary type", error: { ...boardError, error_type: "unknown" } },
    { name: "an untrusted ID field", error: { type: "pcb_placement_error", pcb_trace_error_id: `out_of_board_${base.viaId}` } },
    { name: "conflicting explicit metadata", error: { ...boardError, pcb_via_id: "unknown-via" } },
    { name: "duplicate actual vias", error: boardError, circuitJson: [...base.circuitJson, { ...via }] },
    { name: "a shared via/trace ID", error: boardError, circuitJson: [...base.circuitJson, { ...trace, pcb_trace_id: base.viaId }] },
    { name: "duplicate trace ownership", error: boardError, circuitJson: [...base.circuitJson, { ...trace }] },
    { name: "a missing trace owner", error: boardError, circuitJson: base.circuitJson.map((element) =>
      element.type === "pcb_via" ? { ...element, pcb_trace_id: "missing-owner" } : element) },
  ]
  const pad = makeOriginalViaPlacementMetadataFixture("foreign-pad")
  const actualPad = pad.circuitJson.find((element) => element.type === "pcb_smtpad")!
  if (actualPad.type !== "pcb_smtpad") throw new Error("Expected the actual original surface pad")
  cases.push({ name: "a shared via/pad ID", error: boardError,
    circuitJson: [...base.circuitJson, { ...actualPad, pcb_smtpad_id: base.viaId }] })
  cases.push({ name: "a nonexistent typed pad", error: { ...pad.errors[0]!, pcb_pad_ids: [pad.viaId, "missing-pad"] }, circuitJson: pad.circuitJson })
  for (const scenario of cases) {
    const original = structuredClone(scenario.error)
    expect(addPipeline9OriginalViaPlacementMetadata({ errors: [scenario.error],
      circuitJson: scenario.circuitJson ?? base.circuitJson })[0], scenario.name).toEqual(original)
    expect(scenario.error, scenario.name).toEqual(original)
  }
})
