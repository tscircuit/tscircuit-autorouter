import { expect, test } from "bun:test"
import { remapDrcTraceIds } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { getPipeline9DrcErrorTraceIds, isPipeline9DrcErrorOwnedByPreloadRepair } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import { normalizePipeline9DrcErrorsForRepair } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/normalizePipeline9DrcErrorsForRepair"

test("one reconstructed physical preload contact targets every owned interval without inventing duplicate DRC issues", (): void => {
  const source = { type: "pcb_pad_trace_clearance_error", pcb_trace_id: "full_preload", pcb_pad_id: "pad_at_second_interval", actual_clearance: 0.05 }
  const identities = new Map([["full_preload", "section1_0"], ["new_route", "new_0"]])
  const targets = new Map<string, readonly string[]>([["full_preload", ["section1_0", "section2_0", "section2_0"]]])
  const mapped = remapDrcTraceIds([source], identities, targets)
  expect(mapped).toHaveLength(1)
  expect(mapped[0]!.pcb_trace_id).toBe("section1_0")
  expect(mapped[0]!.__repair_trace_ids).toEqual(["section1_0", "section2_0"])
  expect(getPipeline9DrcErrorTraceIds(mapped[0]!)).toEqual(["section1_0", "section2_0"])
  expect(isPipeline9DrcErrorOwnedByPreloadRepair({ error: mapped[0]!, preloadRepairTraceIds: new Set(["section2_0"]) })).toBe(true)
  expect(source).not.toHaveProperty("__repair_trace_ids")
  const viaIssue = { type: "pcb_via_trace_clearance_error", pcb_trace_id: "new_route", pcb_trace_ids: ["new_route", "full_preload"], pcb_via_id: "via1" }
  const normalized = normalizePipeline9DrcErrorsForRepair({ errors: remapDrcTraceIds([viaIssue], identities, targets),
    circuitJson: [], newTraceIds: new Set(["new_0", "section1_0", "section2_0"]) })
  expect(normalized).toHaveLength(1)
  expect(getPipeline9DrcErrorTraceIds(normalized[0]!)).toEqual(["new_0", "section1_0", "section2_0"])
  const unchangedIdentity = remapDrcTraceIds([{ ...source, pcb_trace_id: "section1_0" }], new Map(), new Map([["section1_0", ["section1_0", "section2_0"]]]))
  expect(getPipeline9DrcErrorTraceIds(unchangedIdentity[0]!)).toEqual(["section1_0", "section2_0"])
})
