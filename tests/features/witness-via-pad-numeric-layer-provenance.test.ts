import { expect, test } from "bun:test"
import { Pipeline9WitnessViaPadRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9WitnessViaPadRepairSolver"
import { witnessViaPadRepairFixture } from "./witnessViaPadRepairFixture"

test("conflicting numeric obstacle layers cannot certify normalized provenance", () => {
  const input = witnessViaPadRepairFixture()
  input.originalSrj.obstacles[2]!.zLayers = [3]
  const solver = new Pipeline9WitnessViaPadRepairSolver(input)
  solver.solve()
  expect(solver.stats.status).toBe("NO_PROPOSAL")
  expect(solver.stats.finalCertificateStatus).toBe("UNKNOWN")
  expect(solver.stats.reasons).toContain("Numeric and named original obstacle layers disagree")
  expect(solver.qualification.bestForeignViaPadFindings).toBe(null)
  expect(solver.getOutput()).toBe(input.traces)
})
