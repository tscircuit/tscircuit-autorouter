import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { LengthMatchingPostProcessingSolver } from "../../lib/solvers/length-matching-post-processing-solver"
import type { SimpleRouteJson } from "../../lib/types"

test("Pipeline9 forwards differential-pair maximum uncoupled length", async () => {
  const fixtureUrl = new URL(
    "../fixtures/core-differential-pair-pad-clearance.json",
    import.meta.url,
  )
  const input: SimpleRouteJson = await Bun.file(fixtureUrl).json()
  input.differentialPairs![0]!.maxUncoupledLength = 3
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input)

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const lengthMatchingStep = solver.pipelineDef.find(
    (step) => step.solverClass === LengthMatchingPostProcessingSolver,
  )
  if (!lengthMatchingStep)
    throw new Error("Expected Pipeline9 length-matching post-processing step")
  expect(lengthMatchingStep.getConstructorParams(solver)[0]).toMatchObject({
    differentialPairs: [{ maxUncoupledLength: 3 }],
  })
})
