import { expect, test } from "bun:test"
import { Pipeline9RelativeWitnessRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RelativeWitnessRepairSolver"
import { relativeWitnessRepairFixture } from "./relativeWitnessRepairFixture"

test("unexpected input corruption is thrown and cannot become an unchanged optimization success", () => {
  const input = relativeWitnessRepairFixture(), solver = new Pipeline9RelativeWitnessRepairSolver(input)
  Object.assign(input.traces[0]!.route[0]!, { x: -1.9 })
  expect(() => solver.solve()).toThrow("mutated protected original/raw/context inputs")
  expect(solver.failed).toBe(true)
  expect(solver.qualification.localRepaired).toBe(false)
  expect(() => solver.getOutput()).toThrow()
})
