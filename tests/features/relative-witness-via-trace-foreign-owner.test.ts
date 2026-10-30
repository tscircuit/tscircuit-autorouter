import { expect, test } from "bun:test"
import { Pipeline9RelativeWitnessRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RelativeWitnessRepairSolver"
import { relativeViaTraceRepairFixture } from "./relativeViaTraceRepairFixture"

test("a same-owner nearby wire cannot become a foreign-wire repair witness", () => {
  for (const owner of ["A", "undeclared-owner"]) {
    const input = relativeViaTraceRepairFixture()
    input.traces.at(-1)!.connection_name = owner
    const bytes = JSON.stringify(input), solver = new Pipeline9RelativeWitnessRepairSolver(input)
    solver.solve()
    expect(solver.qualification.localRepaired).toBe(false)
    expect(solver.qualification.accepted).toBe(false)
    expect(solver.getOutput()).toBe(input.traces)
    expect(solver.selectedMoves).toEqual([])
    expect(JSON.stringify(input)).toBe(bytes)
  }
})
