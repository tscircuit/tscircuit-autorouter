import { expect, test } from "bun:test"
import { Pipeline9WitnessViaPadRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9WitnessViaPadRepairSolver"
import { witnessViaPadRepairFixture } from "./witnessViaPadRepairFixture"

test("unexpected native/oracle exceptions propagate with failed solver state", () => {
  const input = witnessViaPadRepairFixture()
  const solver = new Pipeline9WitnessViaPadRepairSolver(input)
  Object.defineProperty(input.pointPairs, "connections", { get: () => { throw new Error("synthetic oracle invariant failure") } })
  expect(() => solver.solve()).toThrow("synthetic oracle invariant failure")
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.stats.acceptedCandidateCount).toBe(0)
  expect(solver.qualification.protectedUnchanged).toBe(false)
  expect(solver.qualification.status).toBe("BASELINE_CERTIFYING")
  expect(() => solver.getOutput()).toThrow()
})
