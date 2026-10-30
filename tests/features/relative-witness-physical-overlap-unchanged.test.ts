import { expect, test } from "bun:test"
import { Pipeline9RelativeWitnessRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RelativeWitnessRepairSolver"
import { relativeWitnessRepairFixture } from "./relativeWitnessRepairFixture"

test("a physically overlapping foreign pad remains outside the existing relative theorem even when a face move clears geometry", () => {
  const input = relativeWitnessRepairFixture()
  for (const point of input.traces[0]!.route) if ("x" in point && point.x === 0 && point.y === 0.728) point.y = 0.55
  const bytes = JSON.stringify(input), solver = new Pipeline9RelativeWitnessRepairSolver(input)
  solver.solve()
  expect(solver.qualification).toMatchObject({ status: "SEARCH_EXHAUSTED_UNCHANGED", localRepaired: false, accepted: false })
  expect(solver.stats.candidateLedger).toMatchObject([{ geometryFindings: 0, geometryComplete: true, relativeStatus: "UNKNOWN" }])
  expect(solver.getOutput()).toBe(input.traces)
  expect(solver.finalCertificate).toBe(solver.baselineCertificate)
  expect(solver.selectedMoves).toEqual([])
  expect(JSON.stringify(input)).toBe(bytes)
})
