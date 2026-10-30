import { expect, test } from "bun:test"
import { Pipeline9WitnessViaPadRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9WitnessViaPadRepairSolver"
import { witnessViaPadRepairFixture } from "./witnessViaPadRepairFixture"

test("a second bounded scalar evidence path preserves certified proposal progress", () => {
  const input = witnessViaPadRepairFixture()
  const solver = new Pipeline9WitnessViaPadRepairSolver(input)
  solver.solve()
  expect(Object.keys(solver.qualification)).toHaveLength(16)
  expect(Object.values(solver.qualification).every((value) => value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value))).toBe(true)
  expect(solver.qualification.initialForeignViaPadFindings).toBe(1)
  expect(solver.qualification.lastForeignViaPadFindings).toBe(0)
  expect(solver.qualification.bestForeignViaPadFindings).toBe(0)
  expect(solver.qualification.protectedUnchanged).toBe(true)
  expect(solver.qualification.accepted).toBe(1)
  expect(solver.qualification.status).toBe("ACCEPTED")
})
