import { expect, test } from "bun:test"
import { Pipeline9WitnessViaPadRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9WitnessViaPadRepairSolver"
import { witnessViaPadRepairFixture } from "./witnessViaPadRepairFixture"

test("a certified baseline retains the exact original output with zero proposals", () => {
  const input = witnessViaPadRepairFixture(1)
  const before = JSON.stringify(input.traces)
  const solver = new Pipeline9WitnessViaPadRepairSolver(input)
  solver.solve()
  expect(solver.stats.status).toBe("NO_PROPOSAL")
  expect(solver.stats.initialCertificateStatus).toBe("PASS")
  expect(solver.stats.finalCertificateStatus).toBe("PASS")
  expect(solver.stats.proposalCount).toBe(0)
  expect(solver.getOutput()).toBe(input.traces)
  expect(JSON.stringify(solver.getOutput())).toBe(before)
})
