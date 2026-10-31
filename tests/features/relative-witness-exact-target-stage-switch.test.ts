import { expect, test } from "bun:test"
import { Pipeline9RelativeWitnessRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RelativeWitnessRepairSolver"
import { relativeViaTraceAnonymousHardFixture } from "./relativeViaTraceAnonymousHardFixture"

test("production admission rejects a newly closest segment hidden inside native tolerance", () => {
  const input = relativeViaTraceAnonymousHardFixture(), trace = input.traces.find((value) => value.pcb_trace_id === "b-top-foreign")!
  trace.route.splice(0, trace.route.length, ...[[-0.8, 1], [0.8, 1], [0.8, 0.4], [-0.8, 0.4]].map(([x, y]) => ({ route_type: "wire" as const, x: x!, y: y!, width: 0.1, layer: "top" })))
  const solver = new Pipeline9RelativeWitnessRepairSolver(input); solver.solve()
  const first = solver.stats.candidateLedger[0]
  expect(first.geometryFindings).toBe(Number(solver.qualification.beforeGeometryFindings) - 1)
  expect(first.findingPreservationStatus).toBe("PASS")
  expect(first.reason).toContain("exact clearance")
  expect(solver.qualification.localRepaired).toBe(false)
  expect(solver.getOutput()).toBe(input.traces)
})
