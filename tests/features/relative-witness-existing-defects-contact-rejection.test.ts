import { expect, test } from "bun:test"
import { Pipeline9RelativeWitnessRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RelativeWitnessRepairSolver"
import { relativeViaTraceExistingDefectsFixture } from "./relativeViaTraceExistingDefectsFixture"

test("unchanged unrelated finding records never excuse a new moving-via contact with fixed copper", () => {
  const input = relativeViaTraceExistingDefectsFixture()
  input.traces.push({ type: "pcb_trace", pcb_trace_id: "a-fixed-fragment", connection_name: "A", route: [
    { route_type: "wire", x: -0.001, y: 0.551, width: 0.01, layer: "inner1" },
    { route_type: "wire", x: 0.001, y: 0.551, width: 0.01, layer: "inner1" },
  ] })
  const bytes = JSON.stringify(input), solver = new Pipeline9RelativeWitnessRepairSolver(input)
  solver.solve()
  expect(solver.stats.proposalCount).toBe(4)
  expect(solver.stats.candidateLedger.every((row: any) => row.findingPreservationStatus === "PASS" && row.relativeStatus === "UNKNOWN")).toBe(true)
  expect(solver.qualification.status).toBe("SEARCH_EXHAUSTED_UNCHANGED")
  expect(solver.qualification.localRepaired).toBe(false)
  expect(solver.qualification.accepted).toBe(false)
  expect(solver.getOutput()).toBe(input.traces)
  expect(solver.selectedMoves).toEqual([])
  expect(solver.finalCertificate).toBe(solver.baselineCertificate)
  expect(JSON.stringify(input)).toBe(bytes)
})
