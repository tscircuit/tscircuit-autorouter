import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { createGeometryFeedbackFixture } from "../fixtures/pipeline9-geometry-feedback-fixture"

test("an enabled audit with no sound cuts preserves the completed primary plan and reports zero coverage", (): void => {
  const srj = createGeometryFeedbackFixture().srj
  const reference = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(srj), { cacheProvider: null })
  const enabled = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(srj), {
    cacheProvider: null, experimentGeometryFeedback: true,
  })
  reference.solveUntilPhase("highDensityRouteSolver")
  enabled.solveUntilPhase("highDensityRouteSolver")
  expect(enabled.failed).toBeFalse()
  expect(enabled.geometryFeedbackSolver!.solved).toBeTrue()
  expect(enabled.geometryFeedbackStats.activated).toBeTrue()
  expect(enabled.geometryFeedbackStats.audits).toBe(1)
  expect(enabled.geometryFeedbackStats.certificates).toBe(0)
  expect(enabled.geometryFeedbackStats.cuts).toBe(0)
  expect(enabled.geometryFeedbackStats.replans).toBe(0)
  expect(enabled.portPointPathingSolver!.getOutput()).toEqual(reference.portPointPathingSolver!.getOutput())
  expect(enabled.portPointPathingSolver!.iterations).toBe(reference.portPointPathingSolver!.iterations)
  expect(enabled.uniformPortDistributionSolver!.getOutput()).toEqual(reference.uniformPortDistributionSolver!.getOutput())
})
