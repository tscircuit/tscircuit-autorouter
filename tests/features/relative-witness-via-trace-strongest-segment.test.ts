import { expect, test } from "bun:test"
import { Pipeline9RelativeWitnessRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RelativeWitnessRepairSolver"
import { checkPipeline9RelativeViaTraceClearance } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/checkPipeline9RelativeViaTraceClearance"
import { relativeViaTraceAnonymousHardFixture } from "./relativeViaTraceAnonymousHardFixture"

test("production proposals use the globally smallest gap rather than the first diagnostic segment", () => {
  const input = relativeViaTraceAnonymousHardFixture(), trace = input.traces.find((value) => value.pcb_trace_id === "b-top-foreign")!
  trace.route.splice(0, trace.route.length,
    { route_type: "wire", x: 0.8, y: 1.2, width: 0.1, layer: "top" },
    { route_type: "wire", x: 0.1, y: 1, width: 0.1, layer: "top" },
    { route_type: "wire", x: -0.8, y: 1, width: 0.1, layer: "top" })
  const solver = new Pipeline9RelativeWitnessRepairSolver(input); solver.solve()
  expect(solver.qualification.localRepaired).toBe(true)
  expect(solver.qualification.proposals).toBe(1)
  const target = solver.selectedMoves[0]!.occurrences[0]!.newXY
  expect(target.x).toBeCloseTo(0, 12)
  expect(target.y).toBeCloseTo(0.699, 12)
  expect(checkPipeline9RelativeViaTraceClearance({ site: solver.baselineCertificate!.sites[0]!, target, trace, minimumClearance: 0.1 }).status).toBe("PASS")
})
