import { expect, test } from "bun:test"
import { Pipeline9WitnessViaPadRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9WitnessViaPadRepairSolver"
import { witnessViaPadRepairFixture } from "./witnessViaPadRepairFixture"

test("same-owner manufactured-site aliases move together without altering materials", () => {
  const input = witnessViaPadRepairFixture()
  const duplicate = structuredClone(input.traces[0]!)
  duplicate.pcb_trace_id = "a-second-occurrence"
  input.traces.push(duplicate)
  const before = JSON.stringify(input)
  const solver = new Pipeline9WitnessViaPadRepairSolver(input)
  solver.solve()
  expect(solver.stats.status).toBe("ACCEPTED")
  expect(solver.stats.selectedViaOccurrenceCount).toBe(2)
  const output = solver.getOutput()
  expect(output[0]!.route[5]).toEqual(output[2]!.route[5])
  for (const trace of [0, 2]) {
    expect(output[trace]!.route[0]).toEqual(input.traces[trace]!.route[0])
    expect(output[trace]!.route.at(-1)).toEqual(input.traces[trace]!.route.at(-1))
    expect(output[trace]!.pcb_trace_id).toBe(input.traces[trace]!.pcb_trace_id)
  }
  expect(JSON.stringify(input)).toBe(before)
})
