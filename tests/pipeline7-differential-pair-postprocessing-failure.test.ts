import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "../lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { DifferentialPairPostProcessingError } from "../lib/solvers/DifferentialPairPostProcessingError"
import type { SimpleRouteJson } from "../lib/types"
import srj from "./fixtures/core-differential-pair-pad-clearance.json"

test("Pipeline7 fails when pair postprocessing returns diagnostics while retaining geometry", (): void => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(srj) as SimpleRouteJson,
  )

  expect(() => solver.solve()).toThrow(DifferentialPairPostProcessingError)
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.postProcessingErrors).toMatchObject([
    {
      stage: "differentialPairReroutingSolver",
      reason: "no-valid-candidate",
      connectionNames: ["source_trace_0", "source_trace_1"],
    },
  ])
  expect(solver.error).toContain("source_trace_0/source_trace_1")
  expect(solver.powerTraceExpansionSolver).toBeUndefined()
  expect(solver._getOutputHdRoutes()).toHaveLength(2)
})
