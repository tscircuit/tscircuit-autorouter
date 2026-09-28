import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "../lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "../lib/types"
import srj from "./fixtures/core-differential-pair-pad-clearance.json"

test("Pipeline7 returns best-effort routes and diagnostics when pair optimization misses", (): void => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(srj) as SimpleRouteJson,
  )

  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.postProcessingErrors).toMatchObject([
    {
      stage: "differentialPairReroutingSolver",
      reason: "no-valid-candidate",
      connectionNames: ["source_trace_0", "source_trace_1"],
    },
  ])
  expect(solver.error).toBeNull()
  expect(solver.powerTraceExpansionSolver?.solved).toBe(true)
  expect(solver.getOutputSimplifiedPcbTraces()).toHaveLength(2)
})
