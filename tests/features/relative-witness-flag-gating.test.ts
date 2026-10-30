import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { relativeWitnessRepairFixture } from "./relativeWitnessRepairFixture"

test("the relative stage is absent by default and does not replace the legacy experiment when false", () => {
  const input = relativeWitnessRepairFixture()
  for (const options of [{}, { experimentRelativeWitnessRepair: false }, { experimentWitnessViaPadRepair: true }, { experimentWitnessViaPadRepair: true, experimentRelativeWitnessRepair: false }, { experimentRelativeWitnessRepair: true }]) {
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(input.originalSrj), options)
    const names = solver.pipelineDef.map((step) => step.solverName)
    expect(names.includes("relativeWitnessRepairSolver")).toBe(options.experimentRelativeWitnessRepair === true)
    expect(names.includes("witnessViaPadRepairSolver")).toBe(options.experimentWitnessViaPadRepair === true && options.experimentRelativeWitnessRepair !== true)
    expect(Object.hasOwn(solver, "relativeWitnessRepairSolver")).toBe(false)
  }
})
