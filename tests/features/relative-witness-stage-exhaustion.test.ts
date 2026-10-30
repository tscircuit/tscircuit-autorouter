import { expect, test } from "bun:test"
import { Pipeline9RelativeWitnessRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RelativeWitnessRepairSolver"
import { relativeWitnessRepairFixture } from "./relativeWitnessRepairFixture"

test("expected bounded rejection preserves the baseline and full certificate as an explicit negative optimizer result", () => {
  const input = relativeWitnessRepairFixture(), bytes = JSON.stringify(input)
  input.traces[0]!.route.splice(4, 0, { route_type: "wire", x: 0.05, y: 0.75, layer: "inner1", width: 0.1 })
  const immutable = JSON.stringify(input)
  const solver = new Pipeline9RelativeWitnessRepairSolver(input)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.qualification.status).toBe("SEARCH_EXHAUSTED_UNCHANGED")
  expect(solver.qualification.localRepaired).toBe(false)
  expect(solver.qualification.accepted).toBe(false)
  expect(solver.selectedMoves).toEqual([])
  expect(solver.stats.proposalCount).toBeLessThanOrEqual(16)
  expect(solver.iterations).toBeLessThanOrEqual(20)
  expect(solver.getOutput()).toBe(input.traces)
  expect(solver.finalCertificate).toBe(solver.baselineCertificate)
  expect(Object.values(solver.stats.rejectionCounts as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(solver.stats.proposalCount)
  expect(JSON.stringify(input)).toBe(immutable)
  expect(bytes).not.toBe(immutable)
})
